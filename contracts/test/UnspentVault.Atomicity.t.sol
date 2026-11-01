// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {UnspentVault} from "../UnspentVault.sol";
import {UnspentVaultTestBase} from "./UnspentVault.Base.t.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {ToggleToken} from "./mocks/ToggleToken.sol";

/// (7) transfer-failure atomicity, using a token whose transfer can be made to return false / revert.
contract UnspentVaultAtomicityTest is UnspentVaultTestBase {
    ToggleToken internal tt;
    uint256 internal constant AMT = 4_000_000;
    uint256 internal id;

    function _deployToken() internal override returns (MockUSDC) {
        tt = new ToggleToken();
        return tt;
    }

    function setUp() public override {
        super.setUp();
        _deposit(alice, pid, FUND);
        id = _reserveN(1, AMT);
    }

    function _assertUntouched() internal view {
        assertEq(_status(id), uint8(UnspentVault.ReservationStatus.Reserved));
        assertEq(_avail(pid, alice), FUND - AMT);
        assertEq(_resv(pid, alice), AMT);
        assertEq(_settled(pid, alice), 0);
        assertEq(_refunded(pid, alice), 0);
        assertEq(vault.totalOutstandingLiability(), FUND);
        assertEq(vault.providerOutstanding(pid), FUND);
        assertEq(usdc.balanceOf(address(vault)), FUND);
        assertEq(usdc.balanceOf(payout), 0);
        assertEq(vault.getReservation(id).settledAmount, 0);
        assertEq(vault.getReservation(id).responseHash, bytes32(0));
    }

    function test_AcceptAndSettle_PayoutTransferReturnsFalse_RevertsAtomically() public {
        UnspentVault.DeliveryAcceptance memory c = _acc(id, AMT, 1);
        bytes memory sig = _sigAccept(ALICE_PK, c);
        tt.setTransferMode(true, false);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(tt)));
        vault.acceptAndSettle(c, sig);
        _assertUntouched();
        assertFalse(vault.acceptanceNonceUsed(alice, 1), "nonce must stay unused");
        // after the token recovers, the SAME signature settles
        tt.setTransferMode(false, false);
        vm.prank(relayer);
        vault.acceptAndSettle(c, sig);
        assertEq(usdc.balanceOf(payout), AMT);
        assertTrue(vault.acceptanceNonceUsed(alice, 1));
    }

    function test_AcceptAndSettle_PayoutTransferReverts_RevertsAtomically() public {
        UnspentVault.DeliveryAcceptance memory c = _acc(id, AMT, 1);
        bytes memory sig = _sigAccept(ALICE_PK, c);
        tt.setTransferMode(false, true);
        vm.prank(relayer);
        vm.expectRevert(bytes("ToggleToken: transfer reverted"));
        vault.acceptAndSettle(c, sig);
        _assertUntouched();
        assertFalse(vault.acceptanceNonceUsed(alice, 1));
    }

    function test_SettleDirect_PayoutTransferFails_RevertsAtomically() public {
        tt.setTransferMode(true, false);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(tt)));
        vault.settleDirect(id, RESP, 1_000_000);
        _assertUntouched();
        tt.setTransferMode(false, true);
        vm.prank(alice);
        vm.expectRevert(bytes("ToggleToken: transfer reverted"));
        vault.settleDirect(id, RESP, 1_000_000);
        _assertUntouched();
        // still releasable/settleable once the token works again
        tt.setTransferMode(false, false);
        vm.prank(alice);
        vault.settleDirect(id, RESP, 1_000_000);
        assertEq(usdc.balanceOf(payout), 1_000_000);
    }

    function test_Refund_TransferFails_LeavesBalancesUnchanged() public {
        tt.setTransferMode(true, false);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(tt)));
        vault.refund(pid, 1_000_000);
        _assertUntouched();
        assertEq(usdc.balanceOf(alice), 0);

        tt.setTransferMode(false, true);
        vm.prank(alice);
        vm.expectRevert(bytes("ToggleToken: transfer reverted"));
        vault.refund(pid, 1_000_000);
        _assertUntouched();

        tt.setTransferMode(false, false);
        vm.prank(alice);
        vault.refund(pid, 1_000_000);
        assertEq(usdc.balanceOf(alice), 1_000_000);
    }

    function test_Deposit_TransferFromFailure_LeavesBalancesUnchanged() public {
        usdc.mint(bob, 1_000_000);
        vm.prank(bob);
        usdc.approve(address(vault), 1_000_000);
        tt.setTransferFromMode(true, false);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(tt)));
        vault.deposit(pid, 1_000_000);
        tt.setTransferFromMode(false, true);
        vm.prank(bob);
        vm.expectRevert(bytes("ToggleToken: transferFrom reverted"));
        vault.deposit(pid, 1_000_000);
        assertEq(_avail(pid, bob), 0);
        assertEq(_deposited(pid, bob), 0);
        assertEq(vault.totalOutstandingLiability(), FUND);
        assertEq(usdc.balanceOf(bob), 1_000_000);
        _assertUntouched();
    }

    function test_ReleaseExpired_UnaffectedByTransferFailures() public {
        tt.setTransferMode(true, false);
        tt.setTransferFromMode(true, false);
        vm.warp(EXPIRY);
        vault.releaseExpired(id);
        assertEq(_avail(pid, alice), FUND);
    }

    function test_Reserve_UnaffectedByTransferFailures() public {
        tt.setTransferMode(true, false);
        tt.setTransferFromMode(true, false);
        _reserveN(2, 1_000_000);
        assertEq(_resv(pid, alice), AMT + 1_000_000);
    }
}
