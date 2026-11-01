// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MockUSDC} from "./MockUSDC.sol";

/// Mock USDC whose transfer / transferFrom can be told to return false or revert on demand.
contract ToggleToken is MockUSDC {
    bool public falseOnTransfer;
    bool public revertOnTransfer;
    bool public falseOnTransferFrom;
    bool public revertOnTransferFrom;

    function setTransferMode(bool returnFalse, bool doRevert) external {
        falseOnTransfer = returnFalse;
        revertOnTransfer = doRevert;
    }

    function setTransferFromMode(bool returnFalse, bool doRevert) external {
        falseOnTransferFrom = returnFalse;
        revertOnTransferFrom = doRevert;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        if (revertOnTransfer) revert("ToggleToken: transfer reverted");
        if (falseOnTransfer) return false;
        return super.transfer(to, value);
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (revertOnTransferFrom) revert("ToggleToken: transferFrom reverted");
        if (falseOnTransferFrom) return false;
        return super.transferFrom(from, to, value);
    }
}
