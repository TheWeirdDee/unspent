// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {UnspentVault} from "../UnspentVault.sol";
import {UnspentVaultTestBase} from "./UnspentVault.Base.t.sol";

/// (5) provider cannot settle alone; acceptance rules; payout binding.
contract UnspentVaultSettleTest is UnspentVaultTestBase {
    uint256 internal constant AMT = 4_000_000;
    uint256 internal id;

    function setUp() public override {
        super.setUp();
        _deposit(alice, pid, FUND);
        id = _reserveN(1, AMT);
    }

    // ------------------------------------------------------------ happy paths
    function test_AcceptAndSettle_FullAmountPaysPayout() public {
        _accept(_acc(id, AMT, 1));
        assertEq(usdc.balanceOf(payout), AMT);
        assertEq(usdc.balanceOf(address(vault)), FUND - AMT);
        assertEq(_avail(pid, alice), FUND - AMT);
        assertEq(_resv(pid, alice), 0);
        assertEq(_settled(pid, alice), AMT);
        assertEq(vault.totalOutstandingLiability(), FUND - AMT);
        assertEq(vault.providerOutstanding(pid), FUND - AMT);
        assertTrue(vault.acceptanceNonceUsed(alice, 1));
        UnspentVault.Reservation memory r = vault.getReservation(id);
        assertEq(uint8(r.status), uint8(UnspentVault.ReservationStatus.Settled));
        assertEq(r.responseHash, RESP);
        assertEq(r.settledAmount, AMT);
        _assertAccountIdentity(pid, alice);
    }

    function test_AcceptAndSettle_PartialReturnsRemainderToAvailable() public {
        uint256 part = 1_250_000;
        _accept(_acc(id, part, 1));
        assertEq(usdc.balanceOf(payout), part);
        assertEq(_avail(pid, alice), FUND - part);
        assertEq(_resv(pid, alice), 0);
        assertEq(_settled(pid, alice), part);
        assertEq(vault.totalOutstandingLiability(), FUND - part);
        assertEq(vault.getReservation(id).settledAmount, part);
        assertEq(vault.getReservation(id).maxAmount, AMT);
        _assertAccountIdentity(pid, alice);
    }

    function test_AcceptAndSettle_OneMicroUnitPartial() public {
        _accept(_acc(id, 1, 1));
        assertEq(usdc.balanceOf(payout), 1);
        assertEq(_avail(pid, alice), FUND - 1);
    }

    function test_SettleDirect_PartialByCustomer() public {
        vm.prank(alice);
        vault.settleDirect(id, RESP, 100_000); // 0.10 USDC
        assertEq(usdc.balanceOf(payout), 100_000);
        assertEq(_avail(pid, alice), FUND - 100_000);
        assertEq(_settled(pid, alice), 100_000);
        assertEq(vault.getReservation(id).responseHash, RESP);
    }

    function test_SettleDirect_DoesNotConsumeAcceptanceNonce() public {
        vm.prank(alice);
        vault.settleDirect(id, RESP, AMT);
        assertFalse(vault.acceptanceNonceUsed(alice, 0));
        assertFalse(vault.acceptanceNonceUsed(alice, 1));
    }

    function test_Settle_StillWorksForDeactivatedProvider() public {
        vm.prank(providerOwner);
        vault.setProviderActive(pid, false);
        _accept(_acc(id, AMT, 1));
        assertEq(usdc.balanceOf(payout), AMT);
    }

    // ------------------------------------------------------------ provider / relayer cannot settle alone
    function test_RevertWhen_RelayerSettlesWithoutCustomerSignature() public {
        UnspentVault.DeliveryAcceptance memory c = _acc(id, AMT, 1);
        _acceptExpectRevert(c, "", UnspentVault.InvalidSignature.selector);
        _acceptExpectRevert(c, new bytes(65), UnspentVault.InvalidSignature.selector);
        _acceptExpectRevert(c, new bytes(64), UnspentVault.InvalidSignature.selector);
        _acceptExpectRevert(c, hex"deadbeef", UnspentVault.InvalidSignature.selector);
        assertEq(usdc.balanceOf(payout), 0);
        assertEq(_resv(pid, alice), AMT);
    }

    function test_RevertWhen_RelayerOrProviderCallsSettleDirect() public {
        vm.prank(relayer);
        vm.expectRevert(UnspentVault.NotCustomer.selector);
        vault.settleDirect(id, RESP, AMT);
        vm.prank(providerOwner);
        vm.expectRevert(UnspentVault.NotCustomer.selector);
        vault.settleDirect(id, RESP, AMT);
        vm.prank(payout);
        vm.expectRevert(UnspentVault.NotCustomer.selector);
        vault.settleDirect(id, RESP, AMT);
    }

    function test_RevertWhen_AcceptanceSignedByProviderKey() public {
        UnspentVault.DeliveryAcceptance memory c = _acc(id, AMT, 1);
        bytes memory sig = _sigAccept(PROVIDER_PK, c);
        _acceptExpectRevert(c, sig, UnspentVault.InvalidSignature.selector);
        assertEq(usdc.balanceOf(payout), 0);
    }

    function test_RevertWhen_AcceptanceNamesProviderAsCustomer() public {
        UnspentVault.DeliveryAcceptance memory c = _acc(id, AMT, 1);
        c.customer = providerOwner;
        bytes memory sig = _sigAccept(PROVIDER_PK, c); // genuinely signed by the named "customer"
        _acceptExpectRevert(c, sig, UnspentVault.NotCustomer.selector);
    }

    function test_RevertWhen_AcceptanceSignedByOtherCustomer() public {
        UnspentVault.DeliveryAcceptance memory c = _acc(id, AMT, 1);
        bytes memory sig = _sigAccept(BOB_PK, c);
        _acceptExpectRevert(c, sig, UnspentVault.InvalidSignature.selector);
    }

    function test_RevertWhen_WrongResponseHashInSignature() public {
        UnspentVault.DeliveryAcceptance memory c = _acc(id, AMT, 1);
        bytes memory sig = _sigAccept(ALICE_PK, c);
        c.responseHash = RESP2;
        _acceptExpectRevert(c, sig, UnspentVault.InvalidSignature.selector);
    }

    function test_RevertWhen_WrongAmountInSignature() public {
        UnspentVault.DeliveryAcceptance memory c = _acc(id, AMT, 1);
        bytes memory sig = _sigAccept(ALICE_PK, c);
        c.amount = AMT - 1;
        _acceptExpectRevert(c, sig, UnspentVault.InvalidSignature.selector);
    }

    function test_RevertWhen_WrongNonceDeadlineOrReservationInSignature() public {
        uint256 id2 = _reserveN(2, AMT);
        UnspentVault.DeliveryAcceptance memory c = _acc(id, AMT, 1);
        bytes memory sig = _sigAccept(ALICE_PK, c);
        c.nonce = 2;
        _acceptExpectRevert(c, sig, UnspentVault.InvalidSignature.selector);
        c.nonce = 1;
        c.deadline = ACCEPT_DEADLINE + 1;
        _acceptExpectRevert(c, sig, UnspentVault.InvalidSignature.selector);
        c.deadline = ACCEPT_DEADLINE;
        c.reservationId = id2;
        _acceptExpectRevert(c, sig, UnspentVault.InvalidSignature.selector);
    }

    function test_RevertWhen_AcceptanceSignedForOtherChainId() public {
        UnspentVault.DeliveryAcceptance memory c = _acc(id, AMT, 1);
        uint256 real = block.chainid;
        vm.chainId(real + 1);
        bytes memory sig = _sign(ALICE_PK, _acceptDigest(c, address(vault), block.chainid));
        vm.chainId(real);
        _acceptExpectRevert(c, sig, UnspentVault.InvalidSignature.selector);
    }

    function test_RevertWhen_AcceptanceSignedForOtherVault() public {
        UnspentVault.DeliveryAcceptance memory c = _acc(id, AMT, 1);
        bytes memory sig = _sign(ALICE_PK, _acceptDigest(c, address(0xBEEF), block.chainid));
        _acceptExpectRevert(c, sig, UnspentVault.InvalidSignature.selector);
    }

    // ------------------------------------------------------------ acceptance deadline boundaries
    function test_AcceptanceDeadline_OneBefore_Succeeds() public {
        vm.warp(ACCEPT_DEADLINE - 1);
        _accept(_acc(id, AMT, 1));
        assertEq(usdc.balanceOf(payout), AMT);
    }

    function test_AcceptanceDeadline_ExactlyAt_Succeeds() public {
        vm.warp(ACCEPT_DEADLINE);
        _accept(_acc(id, AMT, 1));
        assertEq(usdc.balanceOf(payout), AMT);
    }

    function test_AcceptanceDeadline_OneAfter_Reverts() public {
        vm.warp(ACCEPT_DEADLINE + 1);
        UnspentVault.DeliveryAcceptance memory c = _acc(id, AMT, 1);
        bytes memory sig = _sigAccept(ALICE_PK, c);
        _acceptExpectRevert(c, sig, UnspentVault.AcceptanceExpired.selector);
        assertEq(_status(id), uint8(UnspentVault.ReservationStatus.Reserved));
    }

    // ------------------------------------------------------------ nonce + amount rules
    function test_RevertWhen_AcceptanceNonceReplayedOnAnotherReservation() public {
        uint256 id2 = _reserveN(2, AMT);
        _accept(_acc(id, AMT, 7));
        UnspentVault.DeliveryAcceptance memory c = _acc(id2, AMT, 7);
        bytes memory sig = _sigAccept(ALICE_PK, c);
        _acceptExpectRevert(c, sig, UnspentVault.NonceUsed.selector);
        assertEq(_status(id2), uint8(UnspentVault.ReservationStatus.Reserved));
    }

    function test_RevertWhen_SameAcceptanceReplayedOnSameReservation() public {
        UnspentVault.DeliveryAcceptance memory c = _acc(id, AMT, 7);
        bytes memory sig = _sigAccept(ALICE_PK, c);
        vm.prank(relayer);
        vault.acceptAndSettle(c, sig);
        _acceptExpectRevert(c, sig, UnspentVault.ReservationNotOpen.selector);
        assertEq(usdc.balanceOf(payout), AMT);
    }

    function test_AcceptanceAndReserveNoncesAreIndependent() public {
        assertTrue(vault.reserveNonceUsed(alice, 1));
        assertFalse(vault.acceptanceNonceUsed(alice, 1));
        _accept(_acc(id, AMT, 1)); // same numeric nonce as the reserve nonce
        assertTrue(vault.acceptanceNonceUsed(alice, 1));
    }

    function test_RevertWhen_AmountOverMax() public {
        UnspentVault.DeliveryAcceptance memory c = _acc(id, AMT + 1, 1);
        bytes memory sig = _sigAccept(ALICE_PK, c);
        _acceptExpectRevert(c, sig, UnspentVault.AmountExceedsReservation.selector);
        vm.prank(alice);
        vm.expectRevert(UnspentVault.AmountExceedsReservation.selector);
        vault.settleDirect(id, RESP, AMT + 1);
    }

    function test_RevertWhen_AmountZero() public {
        UnspentVault.DeliveryAcceptance memory c = _acc(id, 0, 1);
        bytes memory sig = _sigAccept(ALICE_PK, c);
        _acceptExpectRevert(c, sig, UnspentVault.AmountExceedsReservation.selector);
        vm.prank(alice);
        vm.expectRevert(UnspentVault.AmountExceedsReservation.selector);
        vault.settleDirect(id, RESP, 0);
    }

    function test_RevertWhen_ResponseHashZero() public {
        UnspentVault.DeliveryAcceptance memory c = _acc(id, AMT, 1);
        c.responseHash = bytes32(0);
        bytes memory sig = _sigAccept(ALICE_PK, c);
        _acceptExpectRevert(c, sig, UnspentVault.InvalidResponseHash.selector);
        vm.prank(alice);
        vm.expectRevert(UnspentVault.InvalidResponseHash.selector);
        vault.settleDirect(id, bytes32(0), AMT);
    }

    // ------------------------------------------------------------ payout binding
    function test_Settle_PaysWalletBoundAtReservationAfterPayoutUpdate() public {
        address newPayout = makeAddr("newPayout");
        vm.prank(providerOwner);
        vault.updateProviderPayout(pid, newPayout);
        assertEq(vault.getReservation(id).payoutWallet, payout);
        _accept(_acc(id, AMT, 1));
        assertEq(usdc.balanceOf(payout), AMT);
        assertEq(usdc.balanceOf(newPayout), 0);
    }

    function test_SettleDirect_PaysBoundWalletAfterPayoutUpdate() public {
        address newPayout = makeAddr("newPayout");
        vm.prank(providerOwner);
        vault.updateProviderPayout(pid, newPayout);
        vm.prank(alice);
        vault.settleDirect(id, RESP, AMT);
        assertEq(usdc.balanceOf(payout), AMT);
        assertEq(usdc.balanceOf(newPayout), 0);
    }

    function test_RevertWhen_NewReservationUsesStalePayoutVersionOrWallet() public {
        address newPayout = makeAddr("newPayout");
        vm.prank(providerOwner);
        vault.updateProviderPayout(pid, newPayout);
        // stale version & stale wallet
        UnspentVault.ReserveAuthorisation memory a = _auth(2, 1_000_000);
        bytes memory sig = _sigReserve(ALICE_PK, a);
        _reserveExpectRevert(a, sig, UnspentVault.PayoutConfigMismatch.selector);
        // new wallet, stale version
        a.payoutWallet = newPayout;
        sig = _sigReserve(ALICE_PK, a);
        _reserveExpectRevert(a, sig, UnspentVault.PayoutConfigMismatch.selector);
        // old wallet, new version
        a.payoutWallet = payout;
        a.payoutVersion = 2;
        sig = _sigReserve(ALICE_PK, a);
        _reserveExpectRevert(a, sig, UnspentVault.PayoutConfigMismatch.selector);
        // current config works and binds the new wallet
        a.payoutWallet = newPayout;
        uint256 id2 = _reserve(a);
        assertEq(vault.getReservation(id2).payoutWallet, newPayout);
        assertEq(vault.getReservation(id2).payoutVersion, 2);
        vm.prank(alice);
        vault.settleDirect(id2, RESP, 1_000_000);
        assertEq(usdc.balanceOf(newPayout), 1_000_000);
    }

    function test_ExistingCreditsRefundableAfterPayoutUpdate() public {
        vm.prank(providerOwner);
        vault.updateProviderPayout(pid, makeAddr("newPayout"));
        uint256 avail = _avail(pid, alice);
        vm.prank(alice);
        vault.refund(pid, avail);
        assertEq(usdc.balanceOf(alice), avail);
        assertEq(_avail(pid, alice), 0);
        assertEq(_resv(pid, alice), AMT);
    }

    function test_ProviderIdsAreIsolated_SettleOnlyAffectsOwnProvider() public {
        _deposit(alice, pidB, FUND);
        vm.prank(alice);
        vault.settleDirect(id, RESP, AMT);
        assertEq(_avail(pidB, alice), FUND);
        assertEq(vault.providerOutstanding(pidB), FUND);
        assertEq(usdc.balanceOf(payout2), 0);
    }
}
