// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MetronomeVault} from "../../src/MetronomeVault.sol";

/// @dev EIP-712 signing helpers shared by unit tests and the invariant handler.
abstract contract Signatures is Test {
    function _digest(MetronomeVault vault, bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", vault.domainSeparator(), structHash));
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signOpen(
        MetronomeVault vault,
        uint256 pk,
        uint256 workerId,
        uint256 shiftId,
        uint64 startAt,
        uint64 deadline
    ) internal view returns (bytes memory) {
        return _sign(
            pk, _digest(vault, keccak256(abi.encode(vault.OPEN_TYPEHASH(), workerId, shiftId, startAt, deadline)))
        );
    }

    function _signClose(
        MetronomeVault vault,
        uint256 pk,
        uint256 workerId,
        uint64 startAt,
        uint64 endAt,
        uint128 rate,
        uint256 shiftId,
        uint64 deadline
    ) internal view returns (bytes memory) {
        return _sign(
            pk,
            _digest(
                vault,
                keccak256(abi.encode(vault.SHIFT_TYPEHASH(), workerId, startAt, endAt, rate, shiftId, deadline))
            )
        );
    }

    function _signCorrection(
        MetronomeVault vault,
        uint256 pk,
        uint256 shiftId,
        uint128 correctGross,
        uint32 version,
        uint64 deadline
    ) internal view returns (bytes memory) {
        return _sign(
            pk,
            _digest(
                vault, keccak256(abi.encode(vault.CORRECTION_TYPEHASH(), shiftId, correctGross, version, deadline))
            )
        );
    }

    function _signWithdraw(
        MetronomeVault vault,
        uint256 pk,
        uint256 workerId,
        uint256 amount,
        uint64 nonce,
        uint64 deadline
    ) internal view returns (bytes memory) {
        return _sign(
            pk, _digest(vault, keccak256(abi.encode(vault.WITHDRAW_TYPEHASH(), workerId, amount, nonce, deadline)))
        );
    }
}
