// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title MockUSD
/// @notice Demo stablecoin used by Kuska on HSK Chain Testnet. 6 decimals, faucet-mintable.
contract MockUSD is ERC20, ERC20Permit {
    uint256 public constant FAUCET_AMOUNT = 100 * 10 ** 6;
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    mapping(address => uint256) public lastFaucetAt;

    error FaucetCooldown(uint256 availableAt);

    constructor() ERC20("Kuska Demo USD", "mUSD") ERC20Permit("Kuska Demo USD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mints 100 mUSD to `to`. Callable once per hour per recipient; the first call
    /// for a given address always succeeds regardless of `block.timestamp`.
    function faucet(address to) external {
        uint256 last = lastFaucetAt[to];
        if (last != 0 && block.timestamp < last + FAUCET_COOLDOWN) {
            revert FaucetCooldown(last + FAUCET_COOLDOWN);
        }
        lastFaucetAt[to] = block.timestamp;
        _mint(to, FAUCET_AMOUNT);
    }
}
