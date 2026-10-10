// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Custody for one shard. Holding each shard's tokens in its own contract means
///         withdrawals in different shards never write the same token balance slot.
contract ShardVault {
    using SafeERC20 for IERC20;

    address public vault;

    error AlreadyInitialized();
    error NotVault();

    /// @dev Called once by MetronomeVault in the same transaction that clones this contract.
    function initialize() external {
        if (vault != address(0)) revert AlreadyInitialized();
        vault = msg.sender;
    }

    function pay(IERC20 token, address to, uint256 amount) external {
        if (msg.sender != vault) revert NotVault();
        token.safeTransfer(to, amount);
    }
}
