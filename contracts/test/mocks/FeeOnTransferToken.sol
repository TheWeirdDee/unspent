// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MockUSDC} from "./MockUSDC.sol";

/// Burns a fee (at least 1 unit) on every wallet-to-wallet transfer, so recipients receive less than `value`.
contract FeeOnTransferToken is MockUSDC {
    uint256 public feeBps = 100; // 1%

    function setFeeBps(uint256 bps) external {
        feeBps = bps;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && value > 0) {
            uint256 fee = (value * feeBps) / 10_000;
            if (fee == 0) fee = 1;
            super._update(from, to, value - fee);
            super._update(from, address(0), fee);
        } else {
            super._update(from, to, value);
        }
    }
}
