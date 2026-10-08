// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MetronomeVault} from "../src/MetronomeVault.sol";
import {ShardVault} from "../src/ShardVault.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {Signatures} from "./utils/Signatures.sol";

contract MetronomeVaultTest is Signatures {
    uint256 constant USD = 1e6;
    uint128 constant RATE = uint128(24 * USD); // $24/h
    uint16 constant BPS = 2000; // 20%
    uint32 constant MAX_SHIFT = 8 hours;
    uint256 constant WORKER = 7;
    uint64 constant T0 = 1_000_000;

    MockERC20 token;
    MetronomeVault vault;

    address admin = makeAddr("admin");
    address taxAddr = makeAddr("tax");
    address relayer = makeAddr("relayer");
    uint256 attestorPk = 0xA77E57;
    uint256 workerPk = 0xB0B;
    address attestor;
    address payout;
    uint256 employerId;
    uint256 nextShift = 1;

    function setUp() public {
        vm.warp(T0);
        attestor = vm.addr(attestorPk);
        payout = vm.addr(workerPk);
        token = new MockERC20();
        vault = new MetronomeVault(token);
        token.mint(admin, 1_000_000 * USD);
        vm.startPrank(admin);
        token.approve(address(vault), type(uint256).max);
        employerId = vault.createEmployer(attestor, taxAddr);
        vault.createWorker(employerId, WORKER, RATE, BPS, MAX_SHIFT, payout);
        vm.stopPrank();
    }

    // ───────────── helpers ─────────────

    function _fund(uint256 id, uint256 amount) internal {
        uint256[] memory ids = new uint256[](1);
        uint256[] memory amounts = new uint256[](1);
        ids[0] = id;
        amounts[0] = amount;
        vm.prank(admin);
        vault.fundWorkers(employerId, ids, amounts);
    }

    function _open(uint256 id) internal returns (uint256 shiftId) {
        shiftId = nextShift++;
        uint64 start = uint64(vm.getBlockTimestamp());
        vault.openShift(
            id, shiftId, start, start + 60, _signOpen(vault, attestorPk, id, shiftId, start, start + 60)
        );
    }

    function _closeWindow(uint256 id, uint256 shiftId, uint64 start, uint64 end) internal {
        uint64 deadline = uint64(vm.getBlockTimestamp()) + 60;
        bytes memory sig = _signClose(vault, attestorPk, id, start, end, RATE, shiftId, deadline);
        vault.closeShift(id, start, end, RATE, shiftId, deadline, sig);
    }

    /// Retroactive shift of `secs` ending now.
    function _shift(uint256 id, uint256 secs) internal returns (uint256 shiftId) {
        shiftId = nextShift++;
        _closeWindow(id, shiftId, uint64(vm.getBlockTimestamp() - secs), uint64(vm.getBlockTimestamp()));
    }

    /// Signed retroactive shift ready to submit, so expectRevert targets the vault call itself.
    function _prepShift(uint256 id, uint256 secs)
        internal
        returns (uint256 shiftId, uint64 start, uint64 end, uint64 deadline, bytes memory sig)
    {
        shiftId = nextShift++;
        end = uint64(vm.getBlockTimestamp());
        start = end - uint64(secs);
        deadline = end + 60;
        sig = _signClose(vault, attestorPk, id, start, end, RATE, shiftId, deadline);
    }

    function _prepOpen(uint256 id) internal returns (uint256 shiftId, uint64 start, bytes memory sig) {
        shiftId = nextShift++;
        start = uint64(vm.getBlockTimestamp());
        sig = _signOpen(vault, attestorPk, id, shiftId, start, start + 60);
    }

    function _correct(uint256 shiftId, uint128 gross, uint32 version) internal {
        uint64 deadline = uint64(vm.getBlockTimestamp()) + 60;
        vault.correctShift(
            shiftId, gross, version, deadline, _signCorrection(vault, attestorPk, shiftId, gross, version, deadline)
        );
    }

    function _withdraw(uint256 id, uint256 amount) internal {
        vm.prank(payout);
        vault.withdraw(id, amount);
    }

    function _state(uint256 id)
        internal
        view
        returns (uint256 funded, uint256 withdrawn, uint256 netSettled, uint256 taxSettled, uint256 taxEscrowed)
    {
        (, funded, withdrawn, netSettled, taxSettled, taxEscrowed,,,,,,,,) = vault.workers(id);
    }

    function _clockInAt(uint256 id) internal view returns (uint64 clockInAt) {
        (,,,,,, clockInAt,,,,,,,) = vault.workers(id);
    }

    function _assertShardBalanced(uint256 s) internal view {
        assertEq(
            token.balanceOf(address(vault.shardVaults(s))),
            vault.alloc(employerId, s) + vault.withheld(employerId, s),
            "shard conservation"
        );
    }

    // ───────────── accrual ─────────────

    function test_ClosedShiftAccrual() public {
        _fund(WORKER, 200 * USD);
        _shift(WORKER, 4 hours);
        (,, uint256 net, uint256 tax,) = _state(WORKER);
        assertEq(net, 768 * USD / 10); // 96 gross − 19.20 tax
        assertEq(tax, 192 * USD / 10);
        assertEq(vault.claimable(WORKER), 768 * USD / 10);
    }

    function test_RateRoundingFavoursNoOverpay() public {
        _fund(WORKER, 200 * USD);
        _shift(WORKER, 1); // 1 second at $24/h = 6666.67 units
        (,, uint256 net, uint256 tax,) = _state(WORKER);
        assertEq(net + tax, 6666);
        assertEq(tax, 1333);
    }

    function test_OpenEstimateTicksAndIsCappedAtMaxShift() public {
        _fund(WORKER, 500 * USD);
        _open(WORKER);
        assertEq(vault.claimable(WORKER), 0);
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        assertEq(vault.claimable(WORKER), 192 * USD / 10); // 24 × 0.8
        vm.warp(vm.getBlockTimestamp() + 20 hours);
        (,, uint256 openGross) = vault.earned(WORKER);
        assertEq(openGross, 192 * USD); // capped at 8h
    }

    function test_CloseReplacesEstimate() public {
        _fund(WORKER, 200 * USD);
        uint64 start = uint64(vm.getBlockTimestamp());
        uint256 id = _open(WORKER);
        vm.warp(start + 4 hours);
        assertEq(vault.claimable(WORKER), 768 * USD / 10);
        _closeWindow(WORKER, id, start, start + 2 hours);
        assertEq(_clockInAt(WORKER), 0);
        assertEq(vault.claimable(WORKER), 384 * USD / 10);
    }

    // ───────────── worked example (docs/architecture.md) ─────────────

    function test_WorkedExampleReconciles() public {
        _fund(WORKER, 200 * USD); // 1
        uint64 start = uint64(vm.getBlockTimestamp());
        uint256 id = _open(WORKER);
        vm.warp(start + 2 hours); // 2
        assertEq(vault.claimable(WORKER), 384 * USD / 10);
        _withdraw(WORKER, 30 * USD); // 3
        assertEq(vault.claimable(WORKER), 84 * USD / 10);
        _closeWindow(WORKER, id, start, start + 90 minutes); // 4
        assertEq(vault.claimable(WORKER), 0);
        assertEq(vault.owedBack(WORKER), 12 * USD / 10);
        assertEq(vault.alloc(employerId, WORKER), 1628 * USD / 10);
        assertEq(vault.withheld(employerId, WORKER), 72 * USD / 10);

        vm.warp(vm.getBlockTimestamp() + 4 hours);
        _shift(WORKER, 4 hours); // 5
        assertEq(vault.claimable(WORKER), 756 * USD / 10);
        assertEq(vault.owedBack(WORKER), 0);

        uint256[] memory shards = new uint256[](1);
        shards[0] = WORKER;
        vm.prank(admin);
        vault.remitWithholding(employerId, shards); // 6
        assertEq(token.balanceOf(taxAddr), 264 * USD / 10);

        _fund(WORKER, 124 * USD); // fund before work, never create arrears
        assertEq(vault.claimable(WORKER), 756 * USD / 10);
        vm.warp(vm.getBlockTimestamp() + 8 hours);
        _shift(WORKER, 8 hours);
        assertEq(vault.claimable(WORKER), 2292 * USD / 10);
        assertEq(vault.arrears(WORKER), 0);

        _withdraw(WORKER, 2292 * USD / 10); // 9
        assertEq(token.balanceOf(payout), 2592 * USD / 10);
        assertEq(vault.alloc(employerId, WORKER), 0);
        assertEq(vault.withheld(employerId, WORKER), 384 * USD / 10);
        // deposited 324 = withdrawn 259.20 + remitted 26.40 + escrow 38.40
        assertEq(324 * USD, token.balanceOf(payout) + token.balanceOf(taxAddr) + vault.withheld(employerId, WORKER));
        _assertShardBalanced(WORKER);
    }

    // ───────────── over-estimates and corrections ─────────────

    function test_OverEstimateRecoveredFromFutureShift() public {
        _fund(WORKER, 500 * USD);
        uint64 start = uint64(vm.getBlockTimestamp());
        uint256 id = _open(WORKER);
        vm.warp(start + 4 hours);
        _withdraw(WORKER, 768 * USD / 10); // full 4h estimate
        _closeWindow(WORKER, id, start, start + 1 hours); // only 1h attested
        assertEq(vault.owedBack(WORKER), 576 * USD / 10);
        assertEq(vault.claimable(WORKER), 0);
        assertEq(token.balanceOf(payout), 768 * USD / 10, "wallet untouched");

        vm.warp(vm.getBlockTimestamp() + 4 hours);
        _shift(WORKER, 4 hours);
        assertEq(vault.owedBack(WORKER), 0);
        assertEq(vault.claimable(WORKER), 192 * USD / 10); // 76.80 − 57.60
    }

    function test_DownwardCorrectionNeverReducesWithdrawn() public {
        _fund(WORKER, 500 * USD);
        uint256 id = _shift(WORKER, 4 hours);
        _withdraw(WORKER, 768 * USD / 10);
        (,,,, uint256 escrowBefore) = _state(WORKER);

        _correct(id, uint128(48 * USD), 1); // really 2h
        (, uint256 withdrawn, uint256 net, uint256 tax, uint256 escrow) = _state(WORKER);
        assertEq(withdrawn, 768 * USD / 10);
        assertEq(net, 384 * USD / 10);
        assertEq(tax, 192 * USD / 10, "tax never decreases");
        assertEq(escrow, escrowBefore);
        assertEq(vault.owedBack(WORKER), 384 * USD / 10);
        assertEq(token.balanceOf(payout), 768 * USD / 10);
    }

    function test_UpwardCorrectionAfterDownwardDoesNotDoubleTax() public {
        _fund(WORKER, 500 * USD);
        uint256 id = _shift(WORKER, 4 hours);
        _correct(id, uint128(48 * USD), 1);
        _correct(id, uint128(96 * USD), 2);
        (,, uint256 net, uint256 tax,) = _state(WORKER);
        assertEq(net, 768 * USD / 10);
        assertEq(tax, 192 * USD / 10);
    }

    function test_CorrectionVersioning() public {
        _fund(WORKER, 500 * USD);
        uint256 id = _shift(WORKER, 4 hours);
        uint64 deadline = uint64(vm.getBlockTimestamp()) + 60;
        bytes memory sig = _signCorrection(vault, attestorPk, id, uint128(50 * USD), 1, deadline);
        vault.correctShift(id, uint128(50 * USD), 1, deadline, sig);
        vm.expectRevert(MetronomeVault.BadVersion.selector);
        vault.correctShift(id, uint128(50 * USD), 1, deadline, sig);
        bytes memory unknownSig = _signCorrection(vault, attestorPk, 999, 1, 1, deadline);
        vm.expectRevert(MetronomeVault.UnknownShift.selector);
        vault.correctShift(999, 1, 1, deadline, unknownSig);
    }

    // ───────────── funding ceiling ─────────────

    function test_WithdrawCappedByFunding() public {
        _fund(WORKER, 50 * USD);
        uint64 start = uint64(vm.getBlockTimestamp());
        uint256 id = _open(WORKER);
        vm.warp(start + 4 hours);
        _closeWindow(WORKER, id, start, start + 4 hours);
        assertEq(vault.claimable(WORKER), 40 * USD);
        vm.prank(payout);
        vm.expectRevert(MetronomeVault.ExceedsClaimable.selector);
        vault.withdraw(WORKER, 40 * USD + 1);
        _withdraw(WORKER, 40 * USD);
        (uint256 funded, uint256 withdrawn,,, uint256 escrow) = _state(WORKER);
        assertEq(withdrawn + escrow, funded);
    }

    function test_UnfundedOfflineSettlementRejected() public {
        (uint256 sid, uint64 st, uint64 en, uint64 dl, bytes memory sig) = _prepShift(WORKER, 4 hours);
        vm.expectRevert(MetronomeVault.ExceedsFunding.selector);
        vault.closeShift(WORKER, st, en, RATE, sid, dl, sig);
        assertEq(vault.claimable(WORKER), 0);
        assertEq(vault.arrears(WORKER), 0);
        (,,,, uint256 escrow) = _state(WORKER);
        assertEq(escrow, 0, "no unbacked escrow");
        _fund(WORKER, 96 * USD);
        assertEq(vault.claimable(WORKER), 0, "funding does not invent earnings");
        vault.closeShift(WORKER, st, en, RATE, sid, dl, sig);
        assertEq(vault.claimable(WORKER), 768 * USD / 10);
        assertEq(vault.withheld(employerId, WORKER), 192 * USD / 10);
        _assertShardBalanced(WORKER);
    }

    function test_OpenEstimateStopsAtFundingCap() public {
        _fund(WORKER, 24 * USD); // 1h of gross
        _open(WORKER);
        vm.warp(vm.getBlockTimestamp() + 5 hours);
        assertEq(vault.claimable(WORKER), 192 * USD / 10);
        (,, uint256 gross) = vault.earned(WORKER);
        assertEq(gross, 24 * USD);
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        assertEq(vault.claimable(WORKER), 192 * USD / 10);
        assertEq(vault.allocationRunway(WORKER), 0);
    }

    function test_RunwayAndReclaim() public {
        _fund(WORKER, 240 * USD);
        assertEq(vault.allocationRunway(WORKER), 10 hours);
        _shift(WORKER, 4 hours);
        assertEq(vault.reclaimable(WORKER), 144 * USD);
        vm.startPrank(admin);
        vm.expectRevert(MetronomeVault.ExceedsReclaimable.selector);
        vault.reclaim(WORKER, 144 * USD + 1);
        vault.reclaim(WORKER, 144 * USD);
        vm.stopPrank();
        assertEq(vault.claimable(WORKER), 768 * USD / 10);
        _assertShardBalanced(WORKER);
    }

    function test_TopUpResumesWithoutBackpayForPausedTime() public {
        _fund(WORKER, 24 * USD);
        uint64 start = uint64(vm.getBlockTimestamp());
        uint256 sid = _open(WORKER);
        vm.warp(start + 3 hours);
        (,, uint256 gross) = vault.earned(WORKER);
        assertEq(gross, 24 * USD);
        _fund(WORKER, 48 * USD);
        (,, gross) = vault.earned(WORKER);
        assertEq(gross, 24 * USD, "no jump at top-up");
        vm.warp(start + 4 hours);
        (,, gross) = vault.earned(WORKER);
        assertEq(gross, 48 * USD);
        _closeWindow(WORKER, sid, start, start + 4 hours);
        (,, uint256 net, uint256 tax,) = _state(WORKER);
        assertEq(net + tax, 48 * USD);
        assertEq(vault.arrears(WORKER), 0);
        _assertShardBalanced(WORKER);
    }

    function test_HistoricalCloseDoesNotUseLaterFunding() public {
        _fund(WORKER, 24 * USD);
        uint64 start = uint64(vm.getBlockTimestamp());
        uint256 sid = _open(WORKER);
        vm.warp(start + 3 hours);
        _fund(WORKER, 72 * USD);
        vm.warp(start + 4 hours);
        _closeWindow(WORKER, sid, start, start + 2 hours);
        (,, uint256 net, uint256 tax,) = _state(WORKER);
        assertEq(net + tax, 24 * USD, "later deposit cannot fund earlier pause");
    }

    function test_SuspensionPausesOpenAccrual() public {
        _fund(WORKER, 200 * USD);
        uint64 start = uint64(vm.getBlockTimestamp());
        _open(WORKER);
        vm.warp(start + 1 hours);
        vm.prank(admin);
        vault.suspend(WORKER);
        vm.warp(start + 3 hours);
        (,, uint256 gross) = vault.earned(WORKER);
        assertEq(gross, 24 * USD);
        vm.prank(admin);
        vault.reinstate(WORKER);
        vm.warp(start + 4 hours);
        (,, gross) = vault.earned(WORKER);
        assertEq(gross, 48 * USD);
    }

    function test_CorrectionCannotConsumeOpenShiftFunding() public {
        _fund(WORKER, 96 * USD);
        uint256 sid = _shift(WORKER, 1 hours);
        _open(WORKER);
        vm.warp(vm.getBlockTimestamp() + 2 hours);
        uint64 deadline = uint64(vm.getBlockTimestamp()) + 60;
        bytes memory sig = _signCorrection(vault, attestorPk, sid, uint128(72 * USD), 1, deadline);
        vm.expectRevert(MetronomeVault.ExceedsFunding.selector);
        vault.correctShift(sid, uint128(72 * USD), 1, deadline, sig);
        (uint256 net, uint256 tax,) = vault.earned(WORKER);
        assertEq(net + tax, 72 * USD);
    }

    function test_RateAndMaxShiftCannotChangeDuringOpenShift() public {
        _open(WORKER);
        vm.startPrank(admin);
        vm.expectRevert(MetronomeVault.OnShift.selector);
        vault.setRate(WORKER, RATE * 2);
        vm.expectRevert(MetronomeVault.OnShift.selector);
        vault.setMaxShift(WORKER, 12 hours);
        vm.stopPrank();
    }

    function test_ReclaimCannotTakeOpenShiftReserve() public {
        _fund(WORKER, 100 * USD);
        _open(WORKER);
        vm.warp(vm.getBlockTimestamp() + 2 hours);
        assertEq(vault.reclaimable(WORKER), 52 * USD);
    }

    // ───────────── withholding ─────────────

    function test_WithholdingEscrowedOnClose() public {
        _fund(WORKER, 200 * USD);
        _shift(WORKER, 4 hours);
        assertEq(vault.withheld(employerId, WORKER), 192 * USD / 10);
        assertEq(vault.alloc(employerId, WORKER), 1808 * USD / 10);
        _assertShardBalanced(WORKER);
    }

    function test_RemitOnlyToTaxAddr() public {
        _fund(WORKER, 200 * USD);
        _shift(WORKER, 4 hours);
        uint256[] memory shards = new uint256[](1);
        shards[0] = WORKER;
        vm.prank(payout);
        vm.expectRevert(MetronomeVault.NotAdmin.selector);
        vault.remitWithholding(employerId, shards);
        vm.prank(admin);
        vault.remitWithholding(employerId, shards);
        assertEq(token.balanceOf(taxAddr), 192 * USD / 10);
        assertEq(token.balanceOf(admin), 1_000_000 * USD - 200 * USD);
        assertEq(vault.withheld(employerId, WORKER), 0);
    }

    function test_SetWithholdingRefusedOnShift() public {
        _open(WORKER);
        vm.prank(admin);
        vm.expectRevert(MetronomeVault.OnShift.selector);
        vault.setWithholding(WORKER, 1000);
    }

    // ───────────── attestation security ─────────────

    function test_ShiftReplayReverts() public {
        _fund(WORKER, 200 * USD);
        uint64 start = uint64(vm.getBlockTimestamp() - 1 hours);
        uint64 end = uint64(vm.getBlockTimestamp());
        uint64 deadline = end + 60;
        bytes memory sig = _signClose(vault, attestorPk, WORKER, start, end, RATE, 42, deadline);
        vault.closeShift(WORKER, start, end, RATE, 42, deadline, sig);
        vm.expectRevert(MetronomeVault.AlreadySettled.selector);
        vault.closeShift(WORKER, start, end, RATE, 42, deadline, sig);
        // a settled shift id cannot be reopened either
        bytes memory openSig = _signOpen(vault, attestorPk, WORKER, 42, end, deadline);
        vm.expectRevert(MetronomeVault.AlreadySettled.selector);
        vault.openShift(WORKER, 42, end, deadline, openSig);
    }

    function test_WrongAttestorReverts() public {
        uint64 start = uint64(vm.getBlockTimestamp() - 1 hours);
        uint64 end = uint64(vm.getBlockTimestamp());
        bytes memory sig = _signClose(vault, 0xBAD, WORKER, start, end, RATE, 1, end + 60);
        vm.expectRevert(MetronomeVault.BadAttestor.selector);
        vault.closeShift(WORKER, start, end, RATE, 1, end + 60, sig);
        // tampered amount with a genuine signature
        sig = _signClose(vault, attestorPk, WORKER, start, end, RATE, 1, end + 60);
        vm.expectRevert(MetronomeVault.BadAttestor.selector);
        vault.closeShift(WORKER, start, end, RATE * 10, 1, end + 60, sig);
    }

    function test_RotatedAttestorTakesEffect() public {
        _fund(WORKER, 200 * USD);
        uint256 newPk = 0xC0FFEE;
        vm.prank(admin);
        vault.rotateAttestor(employerId, vm.addr(newPk));
        uint64 start = uint64(vm.getBlockTimestamp() - 1 hours);
        uint64 end = uint64(vm.getBlockTimestamp());
        bytes memory oldSig = _signClose(vault, attestorPk, WORKER, start, end, RATE, 1, end + 60);
        vm.expectRevert(MetronomeVault.BadAttestor.selector);
        vault.closeShift(WORKER, start, end, RATE, 1, end + 60, oldSig);
        vault.closeShift(
            WORKER, start, end, RATE, 1, end + 60, _signClose(vault, newPk, WORKER, start, end, RATE, 1, end + 60)
        );
    }

    function test_ExpiredAndMalformedRevert() public {
        uint64 now_ = uint64(vm.getBlockTimestamp());
        bytes memory sig = _signClose(vault, attestorPk, WORKER, now_ - 100, now_, RATE, 1, now_ - 1);
        vm.expectRevert(MetronomeVault.Expired.selector);
        vault.closeShift(WORKER, now_ - 100, now_, RATE, 1, now_ - 1, sig);

        sig = _signClose(vault, attestorPk, WORKER, now_, now_, RATE, 1, now_ + 60);
        vm.expectRevert(MetronomeVault.BadWindow.selector);
        vault.closeShift(WORKER, now_, now_, RATE, 1, now_ + 60, sig);

        sig = _signClose(vault, attestorPk, WORKER, now_, now_ + 100, RATE, 1, now_ + 600);
        vm.expectRevert(MetronomeVault.BadWindow.selector); // future-dated end
        vault.closeShift(WORKER, now_, now_ + 100, RATE, 1, now_ + 600, sig);

        sig = _signOpen(vault, attestorPk, WORKER, 1, now_ + 10, now_ + 60);
        vm.expectRevert(MetronomeVault.BadWindow.selector); // future-dated start
        vault.openShift(WORKER, 1, now_ + 10, now_ + 60, sig);
    }

    function test_CannotCloseDifferentShiftWhileOpen() public {
        _open(WORKER);
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        (uint256 sid, uint64 st, uint64 en, uint64 dl, bytes memory sig) = _prepShift(WORKER, 30 minutes);
        vm.expectRevert(MetronomeVault.OtherShiftOpen.selector);
        vault.closeShift(WORKER, st, en, RATE, sid, dl, sig);
        bytes memory openSig;
        (sid, st, openSig) = _prepOpen(WORKER);
        vm.expectRevert(MetronomeVault.OnShift.selector);
        vault.openShift(WORKER, sid, st, st + 60, openSig);
    }

    function test_SuspendedCannotWithdrawOrAttest() public {
        _fund(WORKER, 200 * USD);
        _shift(WORKER, 4 hours);
        vm.prank(admin);
        vault.suspend(WORKER);
        assertEq(vault.claimable(WORKER), 0);
        vm.prank(payout);
        vm.expectRevert(MetronomeVault.IsSuspended.selector);
        vault.withdraw(WORKER, 1);
        (uint256 sid, uint64 st, uint64 en, uint64 dl, bytes memory sig) = _prepShift(WORKER, 1 hours);
        vm.expectRevert(MetronomeVault.IsSuspended.selector);
        vault.closeShift(WORKER, st, en, RATE, sid, dl, sig);
        bytes memory openSig;
        (sid, st, openSig) = _prepOpen(WORKER);
        vm.expectRevert(MetronomeVault.IsSuspended.selector);
        vault.openShift(WORKER, sid, st, st + 60, openSig);

        vm.prank(admin);
        vault.reinstate(WORKER);
        assertEq(vault.claimable(WORKER), 768 * USD / 10, "earned wages survive suspension");
    }

    function test_OnlyAdminControlsWorker() public {
        vm.expectRevert(MetronomeVault.NotAdmin.selector);
        vault.suspend(WORKER);
        vm.expectRevert(MetronomeVault.NotAdmin.selector);
        vault.setRate(WORKER, 1);
        vm.expectRevert(MetronomeVault.NotAdmin.selector);
        vault.createWorker(employerId, 8, RATE, BPS, MAX_SHIFT, payout);
        vm.prank(admin);
        vm.expectRevert(MetronomeVault.WorkerExists.selector);
        vault.createWorker(employerId, WORKER, RATE, BPS, MAX_SHIFT, payout);
    }

    function test_OtherEmployerCannotFundOrAttestForeignWorker() public {
        uint256 otherPk = 0xE1;
        address other = makeAddr("otherAdmin");
        vm.prank(other);
        uint256 otherId = vault.createEmployer(vm.addr(otherPk), other);
        uint256[] memory ids = new uint256[](1);
        uint256[] memory amounts = new uint256[](1);
        ids[0] = WORKER;
        amounts[0] = 1;
        vm.prank(other);
        vm.expectRevert(MetronomeVault.BadWorker.selector);
        vault.fundWorkers(otherId, ids, amounts);

        uint64 start = uint64(vm.getBlockTimestamp() - 1 hours);
        uint64 end = uint64(vm.getBlockTimestamp());
        bytes memory sig = _signClose(vault, otherPk, WORKER, start, end, RATE, 1, end + 60);
        vm.expectRevert(MetronomeVault.BadAttestor.selector);
        vault.closeShift(WORKER, start, end, RATE, 1, end + 60, sig);
    }

    // ───────────── withdrawals ─────────────

    function test_RelayedWithdrawalWithWorkerSignature() public {
        _fund(WORKER, 200 * USD);
        _shift(WORKER, 4 hours);
        uint64 deadline = uint64(vm.getBlockTimestamp()) + 60;
        bytes memory sig = _signWithdraw(vault, workerPk, WORKER, 25 * USD, 0, deadline);
        vm.prank(relayer);
        vault.withdrawWithSig(WORKER, 25 * USD, deadline, sig);
        assertEq(token.balanceOf(payout), 25 * USD);
        assertEq(token.balanceOf(relayer), 0);

        vm.prank(relayer);
        vm.expectRevert(MetronomeVault.BadSigner.selector); // nonce consumed
        vault.withdrawWithSig(WORKER, 25 * USD, deadline, sig);

        bytes memory forged = _signWithdraw(vault, 0xBAD, WORKER, 25 * USD, 1, deadline);
        vm.prank(relayer);
        vm.expectRevert(MetronomeVault.BadSigner.selector);
        vault.withdrawWithSig(WORKER, 25 * USD, deadline, forged);
    }

    function test_DirectWithdrawOnlyFromPayout() public {
        _fund(WORKER, 200 * USD);
        _shift(WORKER, 4 hours);
        vm.prank(relayer);
        vm.expectRevert(MetronomeVault.BadSigner.selector);
        vault.withdraw(WORKER, 1);
        vm.prank(payout);
        vm.expectRevert(MetronomeVault.ExceedsClaimable.selector);
        vault.withdraw(WORKER, 0);
    }

    function test_PayoutAddressOnlyMovedByWorker() public {
        address fresh = makeAddr("fresh");
        vm.prank(admin);
        vm.expectRevert(MetronomeVault.BadSigner.selector);
        vault.setPayoutAddr(WORKER, admin);
        vm.prank(payout);
        vault.setPayoutAddr(WORKER, fresh);
        (,,,,,,,,,,,, address p,) = vault.workers(WORKER);
        assertEq(p, fresh);
    }

    // ───────────── shards ─────────────

    function test_ShardTotalsMatchBalance() public {
        vm.startPrank(admin);
        for (uint256 id = 100; id < 140; ++id) {
            vault.createWorker(employerId, id, RATE, BPS, MAX_SHIFT, payout);
        }
        vm.stopPrank();
        uint256[] memory ids = new uint256[](40);
        uint256[] memory amounts = new uint256[](40);
        for (uint256 i; i < 40; ++i) {
            ids[i] = 100 + i;
            amounts[i] = (50 + i) * USD;
        }
        vm.prank(admin);
        vault.fundWorkers(employerId, ids, amounts);
        for (uint256 i; i < 40; i += 3) {
            _shift(100 + i, 2 hours);
            uint256 c = vault.claimable(100 + i);
            if (c > 0) _withdraw(100 + i, c / 2);
        }
        for (uint256 s; s < vault.SHARDS(); ++s) {
            _assertShardBalanced(s);
        }
    }

    function test_ShardVaultOnlyPaysForVault() public {
        ShardVault shard = vault.shardVaults(0);
        assertEq(shard.vault(), address(vault));
        vm.expectRevert(ShardVault.NotVault.selector);
        shard.pay(token, address(this), 1);
        vm.expectRevert(ShardVault.AlreadyInitialized.selector);
        shard.initialize();
    }

    // ───────────── fuzz ─────────────

    function testFuzz_ClaimableNeverExceedsFunded(uint96 funding, uint32 secs, uint32 openSecs, uint16 bps) public {
        funding = uint96(bound(funding, 0, 100_000 * USD));
        bps = uint16(bound(bps, 0, 10_000));
        secs = uint32(bound(secs, 1, 30 days));
        openSecs = uint32(bound(openSecs, 0, 2 days));
        vm.prank(admin);
        vault.setWithholding(WORKER, bps);
        if (funding > 0) _fund(WORKER, funding);
        uint64 start = uint64(vm.getBlockTimestamp());
        uint256 sid = _open(WORKER);
        vm.warp(vm.getBlockTimestamp() + secs);
        _closeWindow(WORKER, sid, start, uint64(vm.getBlockTimestamp()));
        _open(WORKER);
        vm.warp(vm.getBlockTimestamp() + openSecs);

        (uint256 funded, uint256 withdrawn,,, uint256 escrow) = _state(WORKER);
        (uint256 earnedNet, uint256 earnedTax,) = vault.earned(WORKER);
        assertLe(earnedNet + earnedTax, funded, "no unfunded earnings");
        uint256 c = vault.claimable(WORKER);
        assertLe(c + withdrawn + earnedTax, funded > earnedTax + withdrawn ? funded : earnedTax + withdrawn);
        assertLe(c, earnedNet);
        assertLe(withdrawn + escrow, funded);
        if (c > 0) {
            _withdraw(WORKER, c);
            (funded, withdrawn,,, escrow) = _state(WORKER);
            assertLe(withdrawn + escrow, funded);
        }
        _assertShardBalanced(WORKER);
    }
}
