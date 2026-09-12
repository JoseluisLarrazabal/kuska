// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {KuskaEscrow} from "../src/KuskaEscrow.sol";
import {MockUSD} from "../src/MockUSD.sol";

/// @notice Deploys KuskaEscrow (and MockUSD if no TOKEN_ADDRESS is given) and writes
/// deployments/<chainId>.json in the format required by docs/escrow-interface.md section 5.
contract Deploy is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address arbiter = vm.envAddress("ARBITER_ADDRESS");
        uint64 disputeWindow = uint64(vm.envOr("DISPUTE_WINDOW", uint256(90)));
        address tokenAddress = vm.envOr("TOKEN_ADDRESS", address(0));

        vm.startBroadcast(deployerPk);

        address token = tokenAddress;
        if (token == address(0)) {
            token = address(new MockUSD());
        }

        KuskaEscrow escrow = new KuskaEscrow(token, arbiter, disputeWindow);

        vm.stopBroadcast();

        uint256 chainId = block.chainid;
        uint256 deployBlock = block.number;
        string memory explorer =
            chainId == 177 ? "https://hsk.blockscout.com" : "https://testnet-explorer.hsk.xyz";

        string memory objectKey = "deployment";
        vm.serializeUint(objectKey, "chainId", chainId);
        vm.serializeAddress(objectKey, "escrow", address(escrow));
        vm.serializeAddress(objectKey, "token", token);
        vm.serializeAddress(objectKey, "arbiter", arbiter);
        vm.serializeUint(objectKey, "disputeWindow", disputeWindow);
        vm.serializeUint(objectKey, "deployBlock", deployBlock);
        string memory json = vm.serializeString(objectKey, "explorer", explorer);

        string memory path = string.concat("deployments/", vm.toString(chainId), ".json");
        vm.writeJson(json, path);

        console2.log("KuskaEscrow deployed at:", address(escrow));
        console2.log("Token:", token);
        console2.log("Arbiter:", arbiter);
        console2.log("Deployment written to:", path);
    }
}
