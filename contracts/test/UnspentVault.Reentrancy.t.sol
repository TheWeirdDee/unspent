// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {UnspentVault} from "../UnspentVault.sol";
import {UnspentVaultTestBase} from "./UnspentVault.Base.t.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {ReentrantToken, ReentrancyAttacker} from "./mocks/ReentrantToken.sol";

/// (8) The token calls back into an attacker contract at the end of transferFrom (deposit) / transfer (refund, settle).
/// The attacker is also the provider payout wallet and a customer of the vault.
contract UnspentVaultReentrancyTest is UnspentVaultTestBase {
    ReentrantToken internal rt;
    ReentrancyAttacker internal atk;
    uint256 internal pidR;
    uint256 internal idA;
    uint256 internal idB;
    uint256 internal constant AMT = 3_000_000;

    function _deployToken() internal override returns (MockUSDC) {
        rt = new ReentrantToken();
        return rt;
    }

    function setUp() public override {
        super.setUp();
        atk = new ReentrancyAttacker(address(vault));
        vm.prank(providerOwner);
        pidR = vault.registerProvider(address(atk), META);
        _deposit(alice, pidR, FUND);
        idA = _reserve(_authFor(pidR, address(atk), 1, AMT));
        idB = _reserve(_authFor(pidR, address(atk), 2, AMT));
        usdc.mint(address(atk), FUND);
        atk.approveToken(address(usdc), address(vault), type(uint256).max);
    }

    // ------------------------------------------------------------ payload builders
    function _pDeposit() internal view returns (bytes memory) {
        return abi.encodeCall(vault.deposit, (pidR, 1_000_000));
    }

    function _pRefund(uint256 amount) internal view returns (bytes memory) {
        return abi.encodeCall(vault.refund, (pidR, amount));
    }

    function _pAccept(uint256 id, uint256 nonce) internal view returns (bytes memory) {
        UnspentVault.DeliveryAcceptance memory c = _acc(id, AMT, nonce);
        bytes memory sig = _sigAccept(ALICE_PK, c);
        return abi.encodeCall(vault.acceptAndSettle, (c, sig));
    }

    function _pReserve(uint256 nonce) internal view returns (bytes memory) {
        UnspentVault.ReserveAuthorisation memory a = _authFor(pidR, address(atk), nonce, 1_000_000);
        bytes memory sig = _sigReserve(ALICE_PK, a);
        return abi.encodeCall(vault.reserveWithSignature, (a, sig));
    }

    function _pRelease(uint256 id) internal view returns (bytes memory) {
        return abi.encodeCall(vault.releaseExpired, (id));
    }

    function _pSettleDirect(uint256 id) internal view returns (bytes memory) {
        return abi.encodeCall(vault.settleDirect, (id, RESP, AMT));
    }

    // ------------------------------------------------------------ assertions
    function _assertBlocked() internal view {
        assertTrue(atk.fired(), "hook did not fire");
        assertFalse(atk.ok(), "reentrant call succeeded");
        assertEq(atk.retSelector(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
    }

    function _assertConserved() internal view {
        uint256 sum = _avail(pidR, alice) + _resv(pidR, alice) + _avail(pidR, address(atk)) + _resv(pidR, address(atk));
        assertEq(vault.totalOutstandingLiability(), sum, "liability == sum of balances");
        assertEq(vault.providerOutstanding(pidR), sum);
        assertEq(usdc.balanceOf(address(vault)), sum, "token balance == liability");
        _assertAccountIdentity(pidR, alice);
        _assertAccountIdentity(pidR, address(atk));
    }

    // ------------------------------------------------------------ control
    function test_Control_PayloadsAreValidWhenNotReentrant() public {
        (bool s1,) = atk.execute(_pDeposit());
        assertTrue(s1);
        (bool s2,) = atk.execute(_pAccept(idB, 2));
        assertTrue(s2);
        (bool s3,) = atk.execute(_pReserve(3));
        assertTrue(s3);
        (bool s4,) = atk.execute(_pRefund(1));
        assertTrue(s4);
    }

    // ------------------------------------------------------------ reenter during deposit (transferFrom hook)
    function _depositWithHook(bytes memory payload) internal {
        atk.setPayload(payload);
        rt.arm(address(atk), false, true);
        uint256 liab = vault.totalOutstandingLiability();
        (bool s,) = atk.execute(abi.encodeCall(vault.deposit, (pidR, 2_000_000)));
        assertTrue(s, "outer deposit should complete");
        _assertBlocked();
        assertEq(vault.totalOutstandingLiability(), liab + 2_000_000);
        assertEq(_avail(pidR, address(atk)), 2_000_000);
        assertEq(_deposited(pidR, address(atk)), 2_000_000);
        _assertConserved();
    }

    function test_Reenter_Deposit_FromDepositHook() public {
        _depositWithHook(_pDeposit());
    }

    function test_Reenter_Refund_FromDepositHook() public {
        _depositWithHook(_pRefund(1));
    }

    function test_Reenter_AcceptAndSettle_FromDepositHook() public {
        _depositWithHook(_pAccept(idB, 2));
        assertEq(_status(idB), uint8(UnspentVault.ReservationStatus.Reserved));
    }

    function test_Reenter_ReserveWithSignature_FromDepositHook() public {
        _depositWithHook(_pReserve(3));
        assertFalse(vault.reserveNonceUsed(alice, 3));
    }

    function test_Reenter_ReleaseExpired_FromDepositHook() public {
        vm.warp(EXPIRY);
        _depositWithHook(_pRelease(idB));
        assertEq(_status(idB), uint8(UnspentVault.ReservationStatus.Reserved));
    }

    function test_Reenter_SettleDirect_FromDepositHook() public {
        _depositWithHook(_pSettleDirect(idB));
    }

    // ------------------------------------------------------------ reenter during refund (transfer hook to the refund recipient)
    function _refundWithHook(bytes memory payload) internal {
        (bool d,) = atk.execute(abi.encodeCall(vault.deposit, (pidR, 5_000_000)));
        assertTrue(d);
        uint256 tokenBefore = usdc.balanceOf(address(atk));
        atk.setPayload(payload);
        rt.arm(address(atk), true, false);
        (bool s,) = atk.execute(_pRefund(2_000_000));
        assertTrue(s, "outer refund should complete");
        _assertBlocked();
        assertEq(_avail(pidR, address(atk)), 3_000_000);
        assertEq(_refunded(pidR, address(atk)), 2_000_000);
        assertEq(usdc.balanceOf(address(atk)), tokenBefore + 2_000_000);
        _assertConserved();
    }

    function test_Reenter_Refund_FromRefundHook_CannotDoubleSpend() public {
        _refundWithHook(_pRefund(3_000_000));
    }

    function test_Reenter_Deposit_FromRefundHook() public {
        _refundWithHook(_pDeposit());
    }

    function test_Reenter_AcceptAndSettle_FromRefundHook() public {
        _refundWithHook(_pAccept(idB, 2));
        assertEq(_status(idB), uint8(UnspentVault.ReservationStatus.Reserved));
    }

    function test_Reenter_ReserveWithSignature_FromRefundHook() public {
        _refundWithHook(_pReserve(3));
    }

    function test_Reenter_ReleaseExpired_FromRefundHook() public {
        vm.warp(EXPIRY);
        _refundWithHook(_pRelease(idB));
        assertEq(_status(idB), uint8(UnspentVault.ReservationStatus.Reserved));
    }

    // ------------------------------------------------------------ reenter during settle (transfer hook to payout contract)
    function _settleChecks() internal view {
        _assertBlocked();
        assertEq(_status(idA), uint8(UnspentVault.ReservationStatus.Settled));
        assertEq(_status(idB), uint8(UnspentVault.ReservationStatus.Reserved));
        assertEq(_resv(pidR, alice), AMT);
        assertEq(_avail(pidR, alice), FUND - 2 * AMT);
        assertEq(_settled(pidR, alice), AMT);
        // payout contract (the attacker) received exactly one settlement
        assertEq(usdc.balanceOf(address(atk)), FUND + AMT);
        assertEq(vault.totalOutstandingLiability(), FUND - AMT);
        assertEq(usdc.balanceOf(address(vault)), FUND - AMT);
        _assertAccountIdentity(pidR, alice);
    }

    function _settleViaAcceptWithHook(bytes memory payload) internal {
        UnspentVault.DeliveryAcceptance memory c = _acc(idA, AMT, 1);
        bytes memory sig = _sigAccept(ALICE_PK, c);
        atk.setPayload(payload);
        rt.arm(address(atk), true, false);
        vm.prank(relayer);
        vault.acceptAndSettle(c, sig);
        _settleChecks();
    }

    function test_Reenter_AcceptAndSettle_FromSettleHook_CannotSettleTwice() public {
        _settleViaAcceptWithHook(_pAccept(idB, 2));
    }

    function test_Reenter_AcceptAndSettleSameReservation_FromSettleHook() public {
        _settleViaAcceptWithHook(_pAccept(idA, 9));
    }

    function test_Reenter_Deposit_FromSettleHook() public {
        _settleViaAcceptWithHook(_pDeposit());
    }

    function test_Reenter_Refund_FromSettleHook() public {
        _settleViaAcceptWithHook(_pRefund(1));
    }

    function test_Reenter_ReserveWithSignature_FromSettleHook() public {
        _settleViaAcceptWithHook(_pReserve(3));
        assertFalse(vault.reserveNonceUsed(alice, 3));
    }

    function test_Reenter_ReleaseExpired_FromSettleHook() public {
        _settleViaAcceptWithHook(_pRelease(idB));
    }

    function test_Reenter_SettleDirect_FromSettleHook() public {
        atk.setPayload(_pSettleDirect(idB));
        rt.arm(address(atk), true, false);
        vm.prank(alice);
        vault.settleDirect(idA, RESP, AMT);
        _settleChecks();
    }

    function test_Reenter_AcceptAndSettle_FromSettleDirectHook() public {
        atk.setPayload(_pAccept(idB, 2));
        rt.arm(address(atk), true, false);
        vm.prank(alice);
        vault.settleDirect(idA, RESP, AMT);
        _settleChecks();
    }
}
