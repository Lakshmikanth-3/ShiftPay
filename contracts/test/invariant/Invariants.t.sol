// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MetronomeVault} from "../../src/MetronomeVault.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {Handler} from "./Handler.sol";

/// @notice Stateful invariants I1–I4 from docs/architecture.md.
contract InvariantsTest is Test {
    MockERC20 token;
    MetronomeVault vault;
    Handler handler;

    function setUp() public {
        vm.warp(1_000_000);
        token = new MockERC20();
        vault = new MetronomeVault(token);
        handler = new Handler(vault, token);
        targetContract(address(handler));
    }

    /// I1: no worker has had more paid or escrowed than was deposited for them.
    function invariant_Solvency() public view {
        for (uint256 i; i < handler.workerCount(); ++i) {
            (, uint128 funded, uint128 withdrawn,,, uint128 escrowed,,,,,,,,) = vault.workers(handler.workerIds(i));
            assertLe(uint256(withdrawn) + escrowed, funded, "I1 solvency");
        }
    }

    /// I2: each shard sub-vault holds exactly its employers' unspent allocations plus escrowed tax,
    ///     and total custody equals deposits minus every outflow.
    function invariant_Conservation() public view {
        uint256 total;
        for (uint256 s; s < vault.SHARDS(); ++s) {
            uint256 bal = token.balanceOf(address(vault.shardVaults(s)));
            uint256 owed;
            for (uint256 e; e < 2; ++e) {
                uint256 id = handler.employerIds(e);
                owed += vault.alloc(id, s) + vault.withheld(id, s);
            }
            assertEq(bal, owed, "I2 shard conservation");
            total += bal;
        }
        assertEq(
            total,
            handler.deposited() - handler.paidOut() - handler.remitted() - handler.reclaimed(),
            "I2 global conservation"
        );
    }

    /// I3: payable wages are always backed by unspent funding after tax reserves —
    ///     per worker, and summed per (employer, shard) against the recorded allocation.
    function invariant_NoUnbackedClaims() public view {
        uint256[2][64] memory claimSum;
        for (uint256 i; i < handler.workerCount(); ++i) {
            uint256 id = handler.workerIds(i);
            (, uint128 funded, uint128 withdrawn,,, uint128 escrowed,,,,,,,,) = vault.workers(id);
            (, uint256 earnedTax,) = vault.earned(id);
            uint256 c = vault.claimable(id);
            if (c > 0) assertLe(c + earnedTax + withdrawn, funded, "I3 claimable over reserves");
            assertLe(c, uint256(funded) - withdrawn - escrowed, "I3 claimable over allocation");
            claimSum[id % 64][handler.employerIndex(id)] += c;
        }
        for (uint256 s; s < 64; ++s) {
            for (uint256 e; e < 2; ++e) {
                assertLe(claimSum[s][e], vault.alloc(handler.employerIds(e), s), "I3 shard backing");
            }
        }
    }

    /// I4: withdrawn, settled tax and escrowed tax never decrease.
    function invariant_Monotonic() public view {
        assertFalse(handler.monotonicBroken(), "I4 monotonic");
    }

    function invariant_AllEarningsAreFunded() public view {
        for (uint256 i; i < handler.workerCount(); ++i) {
            uint256 id = handler.workerIds(i);
            (, uint128 funded,,,,,,,,,,,,) = vault.workers(id);
            (uint256 net, uint256 tax,) = vault.earned(id);
            assertLe(net + tax, funded, "gross earnings exceed allocation");
        }
    }
}
