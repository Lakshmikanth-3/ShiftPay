// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MetronomeVault} from "../../src/MetronomeVault.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {Signatures} from "../utils/Signatures.sol";

/// @dev Drives random sequences of payroll actions across two employers whose workers share shards.
contract Handler is Signatures {
    uint256 constant USD = 1e6;

    MetronomeVault public vault;
    MockERC20 public token;

    uint256[2] public employerIds;
    address[2] public admins;
    address[2] public taxAddrs;
    uint256[2] internal attestorPks = [uint256(0xA1), uint256(0xA2)];

    uint256[] public workerIds;
    mapping(uint256 => uint256) public workerPk;
    mapping(uint256 => uint256) public employerIndex;
    mapping(uint256 => uint256) public ghostWithdrawn;
    mapping(uint256 => uint256) public ghostTaxSettled;
    mapping(uint256 => uint256) public ghostEscrowed;
    uint256[] public settledShifts;
    mapping(uint256 => uint32) public shiftVersion;

    bool public monotonicBroken;
    uint256 public deposited;
    uint256 public paidOut;
    uint256 public remitted;
    uint256 public reclaimed;
    uint256 internal nextShiftId = 1;

    constructor(MetronomeVault vault_, MockERC20 token_) {
        vault = vault_;
        token = token_;
        for (uint256 e; e < 2; ++e) {
            admins[e] = makeAddr(string.concat("admin", vm.toString(e)));
            taxAddrs[e] = makeAddr(string.concat("tax", vm.toString(e)));
            token.mint(admins[e], 1e15);
            vm.startPrank(admins[e]);
            token.approve(address(vault), type(uint256).max);
            employerIds[e] = vault.createEmployer(vm.addr(attestorPks[e]), taxAddrs[e]);
            vm.stopPrank();
        }
        // Workers 1..6 for employer 0 and 65..70 for employer 1: same shards 1..6, different employers.
        for (uint256 i = 1; i <= 6; ++i) {
            _addWorker(0, i, uint128((15 + i) * USD), uint16(i * 500));
            _addWorker(1, i + 64, uint128((20 + i) * USD), uint16(i * 300));
        }
    }

    function _addWorker(uint256 e, uint256 id, uint128 rate, uint16 bps) internal {
        uint256 pk = 0xB000 + id;
        vm.prank(admins[e]);
        vault.createWorker(employerIds[e], id, rate, bps, 8 hours, vm.addr(pk));
        workerIds.push(id);
        workerPk[id] = pk;
        employerIndex[id] = e;
    }

    function workerCount() external view returns (uint256) {
        return workerIds.length;
    }

    function _worker(uint256 seed) internal view returns (uint256 id, uint256 e) {
        id = workerIds[seed % workerIds.length];
        e = employerIndex[id];
    }

    function _now() internal view returns (uint64) {
        return uint64(vm.getBlockTimestamp());
    }

    // ───────────── actions ─────────────

    function warp(uint256 secs) external {
        vm.warp(_now() + bound(secs, 1, 12 hours));
    }

    function fund(uint256 seed, uint256 amount) external {
        (uint256 id, uint256 e) = _worker(seed);
        amount = bound(amount, 1, 500 * USD);
        uint256[] memory ids = new uint256[](1);
        uint256[] memory amounts = new uint256[](1);
        ids[0] = id;
        amounts[0] = amount;
        vm.prank(admins[e]);
        vault.fundWorkers(employerIds[e], ids, amounts);
        deposited += amount;
        _track(id);
    }

    function openShift(uint256 seed) external {
        (uint256 id, uint256 e) = _worker(seed);
        (,,,,,, uint64 clockInAt,,,,, uint8 flags,,) = vault.workers(id);
        if (clockInAt != 0 || flags != 1) return;
        uint256 shiftId = nextShiftId++;
        uint64 start = _now();
        bytes memory sig = _signOpen(vault, attestorPks[e], id, shiftId, start, start + 60);
        vault.openShift(id, shiftId, start, start + 60, sig);
    }

    /// Close the open shift (any attested length up to now, possibly shorter than the estimate)
    /// or settle a retroactive shift.
    function closeShift(uint256 seed, uint256 len) external {
        (uint256 id, uint256 e) = _worker(seed);
        (,,,,,, uint64 clockInAt,,,,, uint8 flags,, uint256 openId) = vault.workers(id);
        if (flags != 1) return;
        uint64 end = _now();
        uint64 start;
        uint256 shiftId;
        if (clockInAt != 0) {
            if (end <= clockInAt) return;
            shiftId = openId;
            start = clockInAt;
            end = clockInAt + uint64(bound(len, 1, end - clockInAt)); // attested ≤ elapsed
        } else {
            shiftId = nextShiftId++;
            start = end - uint64(bound(len, 1, 10 hours));
        }
        (uint128 rate,,,,,,,,,,,,,) = vault.workers(id);
        bytes memory sig = _signClose(vault, attestorPks[e], id, start, end, rate, shiftId, _now() + 60);
        vault.closeShift(id, start, end, rate, shiftId, _now() + 60, sig);
        settledShifts.push(shiftId);
        _track(id);
    }

    function correct(uint256 seed, uint256 gross) external {
        if (settledShifts.length == 0) return;
        uint256 shiftId = settledShifts[seed % settledShifts.length];
        (uint256 id,,,,) = vault.shifts(shiftId);
        (,,,,,,,,,,, uint8 flags,,) = vault.workers(id);
        if (flags != 1) return;
        uint32 version = shiftVersion[shiftId] + 1;
        uint128 g = uint128(bound(gross, 0, 300 * USD));
        bytes memory sig = _signCorrection(vault, attestorPks[employerIndex[id]], shiftId, g, version, _now() + 60);
        vault.correctShift(shiftId, g, version, _now() + 60, sig);
        shiftVersion[shiftId] = version;
        _track(id);
    }

    function withdraw(uint256 seed, uint256 fraction, bool relayed) external {
        (uint256 id,) = _worker(seed);
        uint256 c = vault.claimable(id);
        if (c == 0) return;
        uint256 amount = bound(fraction, 1, c);
        (,,,,,,, uint64 nonce,,,,, address payout,) = vault.workers(id);
        if (relayed) {
            bytes memory sig = _signWithdraw(vault, workerPk[id], id, amount, nonce, _now() + 60);
            vault.withdrawWithSig(id, amount, _now() + 60, sig);
        } else {
            vm.prank(payout);
            vault.withdraw(id, amount);
        }
        paidOut += amount;
        _track(id);
    }

    function reclaim(uint256 seed, uint256 fraction) external {
        (uint256 id, uint256 e) = _worker(seed);
        uint256 r = vault.reclaimable(id);
        if (r == 0) return;
        uint256 amount = bound(fraction, 1, r);
        vm.prank(admins[e]);
        vault.reclaim(id, amount);
        reclaimed += amount;
        _track(id);
    }

    function toggleSuspend(uint256 seed) external {
        (uint256 id, uint256 e) = _worker(seed);
        (,,,,,,,,,,, uint8 flags,,) = vault.workers(id);
        vm.prank(admins[e]);
        if (flags == 1) vault.suspend(id);
        else vault.reinstate(id);
    }

    function remit(uint256 seed) external {
        uint256 e = seed % 2;
        uint256[] memory shards = new uint256[](6);
        for (uint256 i; i < 6; ++i) {
            shards[i] = i + 1;
            remitted += vault.withheld(employerIds[e], i + 1);
        }
        vm.prank(admins[e]);
        vault.remitWithholding(employerIds[e], shards);
    }

    // ───────────── ghost tracking ─────────────

    /// Records monotonic fields after every action; a decrease flips `monotonicBroken`.
    function _track(uint256 id) internal {
        (,, uint128 withdrawn,, uint128 taxSettled, uint128 taxEscrowed,,,,,,,,) = vault.workers(id);
        if (withdrawn < ghostWithdrawn[id] || taxSettled < ghostTaxSettled[id] || taxEscrowed < ghostEscrowed[id]) {
            monotonicBroken = true;
        }
        ghostWithdrawn[id] = withdrawn;
        ghostTaxSettled[id] = taxSettled;
        ghostEscrowed[id] = taxEscrowed;
    }
}
