// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
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
        uint256 chainId = block.chainid;
        string memory path = string.concat("deployments/", vm.toString(chainId), ".json");

        require(arbiter != address(0), "ARBITER_ADDRESS required");
        require(
            !vm.exists(path) || vm.envOr("ALLOW_REDEPLOY", false),
            string.concat(
                path, " already exists; re-running this script would orphan the live deployment. Set ALLOW_REDEPLOY=true to override."
            )
        );

        if (tokenAddress == address(0)) {
            require(chainId == 133 || chainId == 31337, "TOKEN_ADDRESS required on this chain");
        } else {
            require(IERC20Metadata(tokenAddress).decimals() == 6, "TOKEN_ADDRESS must have 6 decimals");
            require(_supportsPermit(tokenAddress), "TOKEN_ADDRESS must support EIP-2612 permit (missing nonces()/DOMAIN_SEPARATOR())");
        }

        vm.startBroadcast(deployerPk);

        address token = tokenAddress;
        if (token == address(0)) {
            token = address(new MockUSD());
        }

        KuskaEscrow escrow = new KuskaEscrow(token, arbiter, disputeWindow);

        vm.stopBroadcast();

        string memory explorer = chainId == 177 ? "https://hsk.blockscout.com" : "https://testnet-explorer.hsk.xyz";

        string memory objectKey = "deployment";
        vm.serializeUint(objectKey, "chainId", chainId);
        vm.serializeAddress(objectKey, "escrow", address(escrow));
        vm.serializeAddress(objectKey, "token", token);
        vm.serializeAddress(objectKey, "arbiter", arbiter);
        vm.serializeUint(objectKey, "disputeWindow", disputeWindow);
        vm.serializeUint(objectKey, "deployBlock", block.number);
        string memory json = vm.serializeString(objectKey, "explorer", explorer);

        vm.writeJson(json, path);

        console2.log("KuskaEscrow deployed at:", address(escrow));
        console2.log("Token:", token);
        console2.log("Arbiter:", arbiter);
        console2.log("Deployment written to:", path);
    }

    /// @dev Probes for EIP-2612 permit support via staticcall so a non-permit ERC20
    /// (which passes the decimals() == 6 check but fails deep inside KuskaEscrow's
    /// relayer deposit path with a misleading ERC20InsufficientAllowance) is rejected
    /// here instead, with a clear message.
    function _supportsPermit(address tokenAddress) internal view returns (bool) {
        (bool okNonces, bytes memory nonceData) =
            tokenAddress.staticcall(abi.encodeWithSignature("nonces(address)", address(0)));
        if (!okNonces || nonceData.length != 32) return false;

        (bool okDomain, bytes memory domainData) = tokenAddress.staticcall(abi.encodeWithSignature("DOMAIN_SEPARATOR()"));
        if (!okDomain || domainData.length != 32) return false;

        return true;
    }
}
