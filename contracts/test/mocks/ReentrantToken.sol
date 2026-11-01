// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockUSDC} from "./MockUSDC.sol";

interface ITokenHook {
    function onTokenHook() external;
}

/// Mock USDC that, once armed, calls a hook contract at the END of transfer / transferFrom (one-shot),
/// emulating an ERC-777 style callback that reenters the vault mid-operation.
contract ReentrantToken is MockUSDC {
    address public hook;
    bool public armOnTransfer;
    bool public armOnTransferFrom;

    function arm(address hook_, bool onTransfer_, bool onTransferFrom_) external {
        hook = hook_;
        armOnTransfer = onTransfer_;
        armOnTransferFrom = onTransferFrom_;
    }

    function transfer(address to, uint256 value) public override returns (bool ok) {
        ok = super.transfer(to, value);
        if (armOnTransfer) {
            armOnTransfer = false;
            ITokenHook(hook).onTokenHook();
        }
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool ok) {
        ok = super.transferFrom(from, to, value);
        if (armOnTransferFrom) {
            armOnTransferFrom = false;
            ITokenHook(hook).onTokenHook();
        }
    }
}

/// Acts as a customer / payout contract. `execute` forwards a call to the target with this contract as msg.sender;
/// `onTokenHook` (invoked by ReentrantToken) fires the stored payload and records the outcome without reverting.
contract ReentrancyAttacker is ITokenHook {
    address public immutable target;
    bytes public payload;
    bool public fired;
    bool public ok;
    bytes public ret;

    constructor(address target_) {
        target = target_;
    }

    function setPayload(bytes calldata p) external {
        payload = p;
    }

    function onTokenHook() external override {
        if (payload.length == 0) return;
        fired = true;
        (ok, ret) = target.call(payload);
    }

    function execute(bytes calldata data) external returns (bool success, bytes memory out) {
        (success, out) = target.call(data);
    }

    function approveToken(address token, address spender, uint256 amount) external {
        IERC20(token).approve(spender, amount);
    }

    function retSelector() external view returns (bytes4 sel) {
        bytes memory r = ret;
        if (r.length < 4) return bytes4(0);
        assembly {
            sel := mload(add(r, 32))
        }
    }
}
