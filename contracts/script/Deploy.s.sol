// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MetronomeVault} from "../src/MetronomeVault.sol";

/// @notice Deploys MetronomeVault against the settlement token in AUSD_ADDRESS and, when
///         ATTESTOR_ADDRESS and TAX_ADDRESS are set, registers the deployer as the first employer.
///
///   forge script script/Deploy.s.sol --rpc-url $MONAD_RPC_URL --broadcast
///
/// All values come from the environment; nothing is hard-coded.
contract Deploy is Script {
    function run() external returns (MetronomeVault vault, uint256 employerId) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address token = vm.envOr("SETTLEMENT_TOKEN_ADDRESS", vm.envOr("AUSD_ADDRESS", address(0)));
        require(token != address(0), "Set SETTLEMENT_TOKEN_ADDRESS");
        require(token.code.length > 0, "Settlement token has no code on this network");
        console.log("chain id", block.chainid);
        console.log("token", token);

        vm.startBroadcast(deployerKey);
        vault = new MetronomeVault(IERC20(token));
        address attestor = vm.envOr("ATTESTOR_ADDRESS", address(0));
        address taxAddr = vm.envOr("TAX_ADDRESS", address(0));
        if (attestor != address(0) && taxAddr != address(0)) {
            employerId = vault.createEmployer(attestor, taxAddr);
        }
        vm.stopBroadcast();

        console.log("MetronomeVault", address(vault));
        console.log("employerId", employerId);
    }
}
