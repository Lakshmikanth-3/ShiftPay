// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MetronomeVault} from "../../src/MetronomeVault.sol";

/// @dev Benchmark control: identical accounting and signatures, all workers share shard zero.
///      The same 64 clones are created so construction differs only in routing. Not a production deployment.
contract NaiveVault is MetronomeVault {
    constructor(IERC20 token_) MetronomeVault(token_) {}
    function _shardOf(uint256) internal pure override returns (uint256) { return 0; }
}
