// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ShardVault} from "./ShardVault.sol";

/// @title MetronomeVault
/// @notice Wages accrue against attested work, capped by employer funding, with withholding
///         escrowed for the employer's tax address. Accrual is a view; nothing is written as time passes.
/// @dev Accounting is specified in docs/architecture.md. Worker-path calls write only the worker's
///      own slots plus the (employer, shard) totals, so workers in different shards never conflict.
contract MetronomeVault is EIP712 {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    uint256 public constant SHARDS = 64;
    uint256 internal constant BPS = 10_000;
    uint8 internal constant ACTIVE = 1;
    uint8 internal constant SUSPENDED = 2;

    bytes32 public constant OPEN_TYPEHASH =
        keccak256("OpenShift(uint256 workerId,uint256 shiftId,uint64 startAt,uint64 deadline)");
    bytes32 public constant SHIFT_TYPEHASH = keccak256(
        "Shift(uint256 workerId,uint64 startAt,uint64 endAt,uint128 ratePerHour,uint256 shiftId,uint64 deadline)"
    );
    bytes32 public constant CORRECTION_TYPEHASH =
        keccak256("Correction(uint256 shiftId,uint128 correctGross,uint32 version,uint64 deadline)");
    bytes32 public constant WITHDRAW_TYPEHASH =
        keccak256("Withdraw(uint256 workerId,uint256 amount,uint64 nonce,uint64 deadline)");

    struct Employer {
        address admin;
        address attestor;
        address taxAddr; // immutable once set
    }

    struct Worker {
        // slot 0 — written on rate change and funding
        uint128 ratePerHour; // token units per hour
        uint128 funded; // cumulative gross funding, minus reclaims
        // slot 1 — written on withdrawal and shift settlement
        uint128 withdrawn;
        uint128 netSettled;
        // slot 2 — written on shift settlement
        uint128 taxSettled;
        uint128 taxEscrowed;
        // slot 3 — written on clock in/out and withdrawal
        uint64 clockInAt; // 0 = not on shift
        uint64 nonce; // worker-signed withdrawal nonce
        uint64 employerId;
        uint32 maxShiftSeconds;
        uint16 withholdingBps;
        uint8 flags;
        // slot 4
        address payoutAddr;
        // slot 5
        uint256 openShiftId;
    }

    struct Shift {
        uint256 workerId; // 0 = never settled
        uint128 net; // net currently counted in netSettled
        uint128 tax; // tax counted in taxSettled (never decreases)
        uint32 version;
        uint16 bps;
    }

    struct AccrualSegment {
        uint64 startAt;
        uint128 grossStart;
        uint128 ceiling;
        uint128 rate;
    }

    IERC20 public immutable token;
    ShardVault[SHARDS] public shardVaults;

    uint64 public employerCount;
    mapping(uint256 => Employer) public employers;
    mapping(uint256 => Worker) public workers;
    mapping(uint256 => Shift) public shifts;
    mapping(uint256 => AccrualSegment[]) private accrualSegments;
    mapping(uint256 => mapping(uint256 => uint256)) public alloc; // employerId → shard → unspent worker funding
    mapping(uint256 => mapping(uint256 => uint256)) public withheld; // employerId → shard → escrowed tax

    event EmployerCreated(uint256 indexed employerId, address admin, address attestor, address taxAddr);
    event AttestorRotated(uint256 indexed employerId, address attestor);
    event WorkerCreated(uint256 indexed workerId, uint256 indexed employerId, address payoutAddr);
    event RateSet(uint256 indexed workerId, uint128 ratePerHour);
    event WithholdingSet(uint256 indexed workerId, uint16 bps);
    event MaxShiftSet(uint256 indexed workerId, uint32 maxShiftSeconds);
    event PayoutAddrSet(uint256 indexed workerId, address payoutAddr);
    event Funded(uint256 indexed workerId, uint256 amount);
    event Reclaimed(uint256 indexed workerId, uint256 amount);
    event ShiftOpened(uint256 indexed workerId, uint256 indexed shiftId, uint64 startAt);
    event ShiftClosed(
        uint256 indexed workerId, uint256 indexed shiftId, uint64 startAt, uint64 endAt, uint256 gross, uint256 tax
    );
    event ShiftCorrected(uint256 indexed workerId, uint256 indexed shiftId, uint32 version, uint256 correctGross);
    event TaxEscrowed(uint256 indexed workerId, uint256 amount);
    event Withdrawn(uint256 indexed workerId, uint256 amount, uint256 remaining);
    event WithholdingRemitted(uint256 indexed employerId, uint256 indexed shard, address taxAddr, uint256 amount);
    event Suspended(uint256 indexed workerId);
    event Reinstated(uint256 indexed workerId);

    error NotAdmin();
    error BadAddress();
    error BadWorker();
    error WorkerExists();
    error IsSuspended();
    error Expired();
    error BadWindow();
    error BadAttestor();
    error BadSigner();
    error AlreadySettled();
    error OnShift();
    error OtherShiftOpen();
    error BadVersion();
    error UnknownShift();
    error ExceedsClaimable();
    error ExceedsReclaimable();
    error BadBps();
    error LengthMismatch();
    error ExceedsFunding();

    constructor(IERC20 token_) EIP712("Metronome", "1") {
        if (address(token_) == address(0)) revert BadAddress();
        token = token_;
        address impl = address(new ShardVault());
        for (uint256 i; i < SHARDS; ++i) {
            ShardVault shard = ShardVault(Clones.clone(impl));
            shard.initialize();
            shardVaults[i] = shard;
        }
    }

    // ───────────────────────────── employer admin ─────────────────────────────

    function createEmployer(address attestor, address taxAddr) external returns (uint256 employerId) {
        if (attestor == address(0) || taxAddr == address(0)) revert BadAddress();
        employerId = ++employerCount;
        employers[employerId] = Employer(msg.sender, attestor, taxAddr);
        emit EmployerCreated(employerId, msg.sender, attestor, taxAddr);
    }

    function rotateAttestor(uint256 employerId, address attestor) external {
        _onlyAdmin(employerId);
        if (attestor == address(0)) revert BadAddress();
        employers[employerId].attestor = attestor;
        emit AttestorRotated(employerId, attestor);
    }

    function createWorker(
        uint256 employerId,
        uint256 workerId,
        uint128 ratePerHour,
        uint16 withholdingBps,
        uint32 maxShiftSeconds,
        address payoutAddr
    ) external {
        _onlyAdmin(employerId);
        if (workerId == 0) revert BadWorker();
        if (payoutAddr == address(0)) revert BadAddress();
        if (withholdingBps > BPS) revert BadBps();
        Worker storage w = workers[workerId];
        if (w.flags != 0) revert WorkerExists();
        w.ratePerHour = ratePerHour;
        w.withholdingBps = withholdingBps;
        w.maxShiftSeconds = maxShiftSeconds;
        w.payoutAddr = payoutAddr;
        w.employerId = uint64(employerId);
        w.flags = ACTIVE;
        emit WorkerCreated(workerId, employerId, payoutAddr);
    }

    function setRate(uint256 workerId, uint128 ratePerHour) external {
        Worker storage w = _workerAdmin(workerId);
        if (w.clockInAt != 0) revert OnShift();
        w.ratePerHour = ratePerHour;
        emit RateSet(workerId, ratePerHour);
    }

    /// @dev Refused on shift so an estimate is never split at one rate and settled at another.
    function setWithholding(uint256 workerId, uint16 bps) external {
        Worker storage w = _workerAdmin(workerId);
        if (bps > BPS) revert BadBps();
        if (w.clockInAt != 0) revert OnShift();
        w.withholdingBps = bps;
        emit WithholdingSet(workerId, bps);
    }

    function setMaxShift(uint256 workerId, uint32 maxShiftSeconds) external {
        Worker storage w = _workerAdmin(workerId);
        if (w.clockInAt != 0) revert OnShift();
        w.maxShiftSeconds = maxShiftSeconds;
        emit MaxShiftSet(workerId, maxShiftSeconds);
    }

    function suspend(uint256 workerId) external {
        Worker storage w = _workerAdmin(workerId);
        uint256 gross = _openGrossAt(w, workerId, block.timestamp);
        w.flags |= SUSPENDED;
        _checkpoint(w, workerId, gross);
        emit Suspended(workerId);
    }

    function reinstate(uint256 workerId) external {
        Worker storage w = _workerAdmin(workerId);
        uint256 gross = _openGrossAt(w, workerId, block.timestamp);
        w.flags &= ~SUSPENDED;
        _checkpoint(w, workerId, gross);
        emit Reinstated(workerId);
    }

    /// @notice Deposit gross funding for workers. One token transfer per touched shard.
    function fundWorkers(uint256 employerId, uint256[] calldata ids, uint256[] calldata amounts) external {
        _onlyAdmin(employerId);
        if (ids.length != amounts.length) revert LengthMismatch();
        uint256[SHARDS] memory perShard;
        for (uint256 i; i < ids.length; ++i) {
            uint256 amount = amounts[i];
            if (amount == 0) continue;
            Worker storage w = workers[ids[i]];
            if (w.flags == 0 || w.employerId != employerId) revert BadWorker();
            uint256 s = _shardOf(ids[i]);
            uint256 gross = _openGrossAt(w, ids[i], block.timestamp);
            w.funded += amount.toUint128();
            _checkpoint(w, ids[i], gross);
            alloc[employerId][s] += amount;
            perShard[s] += amount;
            emit Funded(ids[i], amount);
            _syncTax(w, ids[i], employerId, s);
        }
        for (uint256 s; s < SHARDS; ++s) {
            if (perShard[s] != 0) token.safeTransferFrom(msg.sender, address(shardVaults[s]), perShard[s]);
        }
    }

    /// @notice Return funding that is neither earned nor reserved for tax or the open shift.
    function reclaim(uint256 workerId, uint256 amount) external {
        Worker storage w = _workerAdmin(workerId);
        if (amount == 0 || amount > reclaimable(workerId)) revert ExceedsReclaimable();
        uint256 s = _shardOf(workerId);
        uint256 gross = _openGrossAt(w, workerId, block.timestamp);
        w.funded -= amount.toUint128();
        _checkpoint(w, workerId, gross);
        alloc[w.employerId][s] -= amount;
        shardVaults[s].pay(token, msg.sender, amount);
        emit Reclaimed(workerId, amount);
    }

    /// @notice Send escrowed withholding to the employer's fixed tax address.
    function remitWithholding(uint256 employerId, uint256[] calldata shardIds) external {
        _onlyAdmin(employerId);
        address taxAddr = employers[employerId].taxAddr;
        for (uint256 i; i < shardIds.length; ++i) {
            uint256 s = shardIds[i];
            uint256 amount = withheld[employerId][s];
            if (amount == 0) continue;
            withheld[employerId][s] = 0;
            shardVaults[s].pay(token, taxAddr, amount);
            emit WithholdingRemitted(employerId, s, taxAddr, amount);
        }
    }

    // ───────────────────────────── attestations ─────────────────────────────

    function openShift(uint256 workerId, uint256 shiftId, uint64 startAt, uint64 deadline, bytes calldata sig)
        external
    {
        Worker storage w = _activeWorker(workerId);
        if (block.timestamp > deadline) revert Expired();
        if (startAt == 0 || startAt > block.timestamp) revert BadWindow();
        if (w.clockInAt != 0) revert OnShift();
        if (shiftId == 0 || shifts[shiftId].workerId != 0) revert AlreadySettled();
        _checkAttestor(w, keccak256(abi.encode(OPEN_TYPEHASH, workerId, shiftId, startAt, deadline)), sig);

        w.clockInAt = startAt;
        w.openShiftId = shiftId;
        delete accrualSegments[workerId];
        accrualSegments[workerId].push(AccrualSegment(startAt, 0, _grossBudget(w).toUint128(), w.ratePerHour));
        emit ShiftOpened(workerId, shiftId, startAt);
    }

    /// @notice Settle an attested shift. Replaces the open-shift estimate when it closes the open shift.
    function closeShift(
        uint256 workerId,
        uint64 startAt,
        uint64 endAt,
        uint128 ratePerHour,
        uint256 shiftId,
        uint64 deadline,
        bytes calldata sig
    ) external {
        Worker storage w = _activeWorker(workerId);
        if (block.timestamp > deadline) revert Expired();
        if (endAt <= startAt || endAt > block.timestamp) revert BadWindow();
        if (shiftId == 0 || shifts[shiftId].workerId != 0) revert AlreadySettled();
        if (w.clockInAt != 0 && w.openShiftId != shiftId) revert OtherShiftOpen();
        _checkAttestor(
            w,
            keccak256(abi.encode(SHIFT_TYPEHASH, workerId, startAt, endAt, ratePerHour, shiftId, deadline)),
            sig
        );

        uint16 bps = w.withholdingBps;
        uint256 gross = uint256(ratePerHour) * (endAt - startAt) / 3600;
        if (w.clockInAt != 0) {
            if (startAt != w.clockInAt) revert BadWindow();
            gross = _min(gross, _openGrossAt(w, workerId, endAt));
        } else if (gross > _grossBudget(w)) revert ExceedsFunding();
        (uint256 net, uint256 tax) = _split(gross, bps);

        w.netSettled += net.toUint128();
        w.taxSettled += tax.toUint128();
        if (w.clockInAt != 0) {
            w.clockInAt = 0;
            w.openShiftId = 0;
            delete accrualSegments[workerId];
        }
        shifts[shiftId] = Shift(workerId, net.toUint128(), tax.toUint128(), 0, bps);

        emit ShiftClosed(workerId, shiftId, startAt, endAt, gross, tax);
        _syncTax(w, workerId, w.employerId, _shardOf(workerId));
    }

    /// @notice Correct a settled shift. Downward corrections lower net only and are recovered from
    ///         future accrual; `withdrawn` and escrowed tax never decrease.
    function correctShift(uint256 shiftId, uint128 correctGross, uint32 version, uint64 deadline, bytes calldata sig)
        external
    {
        Shift storage sh = shifts[shiftId];
        uint256 workerId = sh.workerId;
        if (workerId == 0) revert UnknownShift();
        Worker storage w = _activeWorker(workerId);
        if (block.timestamp > deadline) revert Expired();
        if (version != sh.version + 1) revert BadVersion();
        _checkAttestor(w, keccak256(abi.encode(CORRECTION_TYPEHASH, shiftId, correctGross, version, deadline)), sig);

        (uint256 net, uint256 tax) = _split(correctGross, sh.bps);
        uint256 openGross = _openGrossAt(w, workerId, block.timestamp);
        uint256 nextNet = uint256(w.netSettled) - sh.net + net;
        uint256 nextTax = uint256(w.taxSettled) + (tax > sh.tax ? tax - sh.tax : 0);
        if (nextNet + nextTax + openGross > w.funded) revert ExceedsFunding();
        if (net > sh.net) w.netSettled += uint128(net - sh.net);
        else w.netSettled -= uint128(sh.net - net);
        if (tax > sh.tax) {
            w.taxSettled += uint128(tax - sh.tax);
            sh.tax = uint128(tax);
        }
        sh.net = uint128(net);
        sh.version = version;
        _checkpoint(w, workerId, openGross);

        emit ShiftCorrected(workerId, shiftId, version, correctGross);
        _syncTax(w, workerId, w.employerId, _shardOf(workerId));
    }

    // ───────────────────────────── withdrawals ─────────────────────────────

    /// @notice Withdraw directly from the payout wallet.
    function withdraw(uint256 workerId, uint256 amount) external {
        Worker storage w = workers[workerId];
        if (msg.sender != w.payoutAddr) revert BadSigner();
        _withdraw(w, workerId, amount);
    }

    /// @notice Relayer-submitted withdrawal signed by the worker's payout wallet. Gas is paid by the submitter.
    function withdrawWithSig(uint256 workerId, uint256 amount, uint64 deadline, bytes calldata sig) external {
        Worker storage w = workers[workerId];
        if (block.timestamp > deadline) revert Expired();
        bytes32 digest =
            _hashTypedDataV4(keccak256(abi.encode(WITHDRAW_TYPEHASH, workerId, amount, w.nonce, deadline)));
        if (w.payoutAddr == address(0) || ECDSA.recover(digest, sig) != w.payoutAddr) revert BadSigner();
        ++w.nonce;
        _withdraw(w, workerId, amount);
    }

    /// @notice Only the worker can move their payout address.
    function setPayoutAddr(uint256 workerId, address payoutAddr) external {
        Worker storage w = workers[workerId];
        if (msg.sender != w.payoutAddr) revert BadSigner();
        if (payoutAddr == address(0)) revert BadAddress();
        w.payoutAddr = payoutAddr;
        emit PayoutAddrSet(workerId, payoutAddr);
    }

    // ───────────────────────────── views ─────────────────────────────

    /// @notice Lazily computed earnings including the open-shift estimate.
    function earned(uint256 workerId) public view returns (uint256 earnedNet, uint256 earnedTax, uint256 openGross) {
        Worker storage w = workers[workerId];
        earnedNet = w.netSettled;
        earnedTax = w.taxSettled;
        if (w.clockInAt != 0 && block.timestamp > w.clockInAt) {
            openGross = _openGrossAt(w, workerId, block.timestamp);
            (uint256 net, uint256 tax) = _split(openGross, w.withholdingBps);
            earnedNet += net;
            earnedTax += tax;
        }
    }

    /// @notice What the worker can take now: earned, net of withholding, and funded.
    function claimable(uint256 workerId) public view returns (uint256) {
        Worker storage w = workers[workerId];
        if (w.flags != ACTIVE) return 0;
        (uint256 earnedNet, uint256 earnedTax,) = earned(workerId);
        uint256 withdrawn = w.withdrawn;
        if (earnedNet <= withdrawn) return 0;
        uint256 reserved = earnedTax + withdrawn;
        if (w.funded <= reserved) return 0;
        return _min(earnedNet - withdrawn, w.funded - reserved);
    }

    /// @notice Over-estimate or downward correction still to be recovered from future accrual.
    function owedBack(uint256 workerId) external view returns (uint256) {
        (uint256 earnedNet,,) = earned(workerId);
        uint256 withdrawn = workers[workerId].withdrawn;
        return withdrawn > earnedNet ? withdrawn - earnedNet : 0;
    }

    /// @notice Net wages earned but not yet payable because funding is short.
    function arrears(uint256 workerId) external view returns (uint256) {
        Worker storage w = workers[workerId];
        if (w.flags != ACTIVE) return 0;
        (uint256 earnedNet,,) = earned(workerId);
        if (earnedNet <= w.withdrawn) return 0;
        return earnedNet - w.withdrawn - claimable(workerId);
    }

    /// @notice Funding not earned and not reserved for tax or the open shift.
    function reclaimable(uint256 workerId) public view returns (uint256) {
        Worker storage w = workers[workerId];
        (uint256 earnedNet, uint256 earnedTax,) = earned(workerId);
        uint256 reserved = _max(w.withdrawn, earnedNet) + earnedTax;
        return w.funded > reserved ? w.funded - reserved : 0;
    }

    /// @notice Seconds of accrual at the current rate before payable wages reach the funding cap.
    function allocationRunway(uint256 workerId) external view returns (uint64) {
        Worker storage w = workers[workerId];
        if (w.ratePerHour == 0) return type(uint64).max;
        uint256 secs = reclaimable(workerId) * 3600 / w.ratePerHour;
        return secs > type(uint64).max ? type(uint64).max : uint64(secs);
    }

    function shardOf(uint256 workerId) external pure returns (uint256) {
        return _shardOf(workerId);
    }

    function _shardOf(uint256 workerId) internal pure virtual returns (uint256) {
        return workerId % SHARDS;
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ───────────────────────────── internals ─────────────────────────────

    function _grossBudget(Worker storage w) internal view returns (uint256) {
        uint256 settled = uint256(w.netSettled) + w.taxSettled;
        return w.funded > settled ? w.funded - settled : 0;
    }

    function _openGrossAt(Worker storage w, uint256 workerId, uint256 at) internal view returns (uint256) {
        if (w.clockInAt == 0 || at <= w.clockInAt) return 0;
        uint256 stop = uint256(w.clockInAt) + w.maxShiftSeconds;
        if (at > stop) at = stop;
        AccrualSegment[] storage segments = accrualSegments[workerId];
        for (uint256 i = segments.length; i > 0; --i) {
            AccrualSegment storage segment = segments[i - 1];
            if (segment.startAt > at) continue;
            return _min(uint256(segment.grossStart) + uint256(segment.rate) * (at - segment.startAt) / 3600, segment.ceiling);
        }
        return 0;
    }

    function _checkpoint(Worker storage w, uint256 workerId, uint256 gross) internal {
        if (w.clockInAt == 0) return;
        AccrualSegment memory segment = AccrualSegment(block.timestamp.toUint64(), gross.toUint128(), _grossBudget(w).toUint128(), w.flags == ACTIVE ? w.ratePerHour : 0);
        AccrualSegment[] storage segments = accrualSegments[workerId];
        if (segments.length != 0 && segments[segments.length - 1].startAt == block.timestamp) segments[segments.length - 1] = segment;
        else segments.push(segment);
    }

    function _withdraw(Worker storage w, uint256 workerId, uint256 amount) internal {
        if (w.flags != ACTIVE) revert IsSuspended();
        uint256 avail = claimable(workerId);
        if (amount == 0 || amount > avail) revert ExceedsClaimable();
        uint256 s = _shardOf(workerId);
        w.withdrawn += amount.toUint128();
        alloc[w.employerId][s] -= amount;
        shardVaults[s].pay(token, w.payoutAddr, amount);
        emit Withdrawn(workerId, amount, avail - amount);
    }

    /// @dev Move settled withholding into escrow as far as funding allows. No tokens move.
    function _syncTax(Worker storage w, uint256 workerId, uint256 employerId, uint256 s) internal {
        uint256 cap = w.funded - w.withdrawn;
        uint256 target = _min(w.taxSettled, cap);
        uint256 escrowed = w.taxEscrowed;
        if (target <= escrowed) return;
        uint256 delta = target - escrowed;
        w.taxEscrowed = uint128(target);
        alloc[employerId][s] -= delta;
        withheld[employerId][s] += delta;
        emit TaxEscrowed(workerId, delta);
    }

    function _checkAttestor(Worker storage w, bytes32 structHash, bytes calldata sig) internal view {
        address signer = ECDSA.recover(_hashTypedDataV4(structHash), sig);
        if (signer != employers[w.employerId].attestor) revert BadAttestor();
    }

    function _activeWorker(uint256 workerId) internal view returns (Worker storage w) {
        w = workers[workerId];
        if (w.flags == 0) revert BadWorker();
        if (w.flags & SUSPENDED != 0) revert IsSuspended();
    }

    function _workerAdmin(uint256 workerId) internal view returns (Worker storage w) {
        w = workers[workerId];
        if (w.flags == 0) revert BadWorker();
        _onlyAdmin(w.employerId);
    }

    function _onlyAdmin(uint256 employerId) internal view {
        if (employers[employerId].admin != msg.sender || msg.sender == address(0)) revert NotAdmin();
    }

    function _split(uint256 gross, uint16 bps) internal pure returns (uint256 net, uint256 tax) {
        tax = gross * bps / BPS;
        net = gross - tax;
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function _max(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a : b;
    }
}
