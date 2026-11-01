// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {UnspentVault} from "../UnspentVault.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// Shared fixtures. Digests are computed here WITHOUT calling the vault so the contract's hashing is checked independently.
abstract contract UnspentVaultTestBase is Test {
    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant RESERVE_TYPEHASH = keccak256(
        "ReserveAuthorisation(address customer,uint256 providerId,address payoutWallet,uint32 payoutVersion,bytes32 requestHash,uint256 maxAmount,uint256 nonce,uint256 authDeadline,uint256 expiry)"
    );
    bytes32 internal constant ACCEPT_TYPEHASH = keccak256(
        "DeliveryAcceptance(address customer,uint256 reservationId,bytes32 responseHash,uint256 amount,uint256 nonce,uint256 deadline)"
    );
    uint256 internal constant SECP_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    uint256 internal constant ALICE_PK = 0xA11CE;
    uint256 internal constant BOB_PK = 0xB0B;
    uint256 internal constant CAROL_PK = 0xCA401;
    uint256 internal constant MALLORY_PK = 0xBAD;
    uint256 internal constant PROVIDER_PK = 0x9701;

    uint256 internal constant T0 = 1_700_000_000;
    uint256 internal constant AUTH_DEADLINE = T0 + 1 hours;
    uint256 internal constant ACCEPT_DEADLINE = T0 + 90 minutes;
    uint256 internal constant EXPIRY = T0 + 2 hours;
    bytes32 internal constant META = keccak256("meta");
    bytes32 internal constant RESP = keccak256("response");
    bytes32 internal constant RESP2 = keccak256("other response");
    uint256 internal constant FUND = 10_000_000; // 10 USDC in micro-USDC

    address internal alice = vm.addr(ALICE_PK);
    address internal bob = vm.addr(BOB_PK);
    address internal carol = vm.addr(CAROL_PK);
    address internal mallory = vm.addr(MALLORY_PK);
    address internal providerOwner = vm.addr(PROVIDER_PK);
    address internal providerOwner2 = makeAddr("providerOwner2");
    address internal payout = makeAddr("payout");
    address internal payout2 = makeAddr("payout2");
    address internal relayer = makeAddr("relayer");

    UnspentVault internal vault;
    MockUSDC internal usdc;
    uint256 internal pid;
    uint256 internal pidB;

    function setUp() public virtual {
        vm.warp(T0);
        usdc = _deployToken();
        vault = new UnspentVault(IERC20(address(usdc)));
        vm.prank(providerOwner);
        pid = vault.registerProvider(payout, META);
        vm.prank(providerOwner2);
        pidB = vault.registerProvider(payout2, META);
    }

    function _deployToken() internal virtual returns (MockUSDC) {
        return new MockUSDC();
    }

    // ---------------------------------------------------------------- digests (independent of the vault)
    function _domainSeparator(address verifying, uint256 chainId) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256("UnspentVault"), keccak256("1"), chainId, verifying)
        );
    }

    function _reserveStructHash(UnspentVault.ReserveAuthorisation memory a) internal pure returns (bytes32) {
        bytes memory head = abi.encode(RESERVE_TYPEHASH, a.customer, a.providerId, a.payoutWallet, a.payoutVersion);
        bytes memory tail = abi.encode(a.requestHash, a.maxAmount, a.nonce, a.authDeadline, a.expiry);
        return keccak256(bytes.concat(head, tail));
    }

    function _reserveDigest(UnspentVault.ReserveAuthorisation memory a, address verifying, uint256 chainId)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(verifying, chainId), _reserveStructHash(a)));
    }

    function _acceptStructHash(UnspentVault.DeliveryAcceptance memory c) internal pure returns (bytes32) {
        return keccak256(abi.encode(ACCEPT_TYPEHASH, c.customer, c.reservationId, c.responseHash, c.amount, c.nonce, c.deadline));
    }

    function _acceptDigest(UnspentVault.DeliveryAcceptance memory c, address verifying, uint256 chainId)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(verifying, chainId), _acceptStructHash(c)));
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    // ---------------------------------------------------------------- builders
    function _authFor(uint256 p, address payoutWallet, uint256 nonce, uint256 amount)
        internal
        view
        returns (UnspentVault.ReserveAuthorisation memory a)
    {
        a = UnspentVault.ReserveAuthorisation({
            customer: alice,
            providerId: p,
            payoutWallet: payoutWallet,
            payoutVersion: 1,
            requestHash: keccak256(abi.encode("req", nonce)),
            maxAmount: amount,
            nonce: nonce,
            authDeadline: AUTH_DEADLINE,
            expiry: EXPIRY
        });
    }

    function _auth(uint256 nonce, uint256 amount) internal view returns (UnspentVault.ReserveAuthorisation memory) {
        return _authFor(pid, payout, nonce, amount);
    }

    function _sigReserve(uint256 pk, UnspentVault.ReserveAuthorisation memory a) internal view returns (bytes memory) {
        return _sign(pk, _reserveDigest(a, address(vault), block.chainid));
    }

    function _submit(UnspentVault.ReserveAuthorisation memory a, bytes memory sig) internal returns (uint256 id) {
        vm.prank(relayer);
        id = vault.reserveWithSignature(a, sig);
    }

    function _reserve(UnspentVault.ReserveAuthorisation memory a) internal returns (uint256) {
        bytes memory sig = _sigReserve(ALICE_PK, a);
        return _submit(a, sig);
    }

    function _reserveN(uint256 nonce, uint256 amount) internal returns (uint256) {
        return _reserve(_auth(nonce, amount));
    }

    function _reserveExpectRevert(UnspentVault.ReserveAuthorisation memory a, bytes memory sig, bytes4 sel) internal {
        vm.prank(relayer);
        vm.expectRevert(sel);
        vault.reserveWithSignature(a, sig);
    }

    function _acc(uint256 id, uint256 amount, uint256 nonce) internal pure returns (UnspentVault.DeliveryAcceptance memory) {
        return UnspentVault.DeliveryAcceptance({
            customer: vm.addr(ALICE_PK),
            reservationId: id,
            responseHash: RESP,
            amount: amount,
            nonce: nonce,
            deadline: ACCEPT_DEADLINE
        });
    }

    function _sigAccept(uint256 pk, UnspentVault.DeliveryAcceptance memory c) internal view returns (bytes memory) {
        return _sign(pk, _acceptDigest(c, address(vault), block.chainid));
    }

    function _accept(UnspentVault.DeliveryAcceptance memory c) internal {
        bytes memory sig = _sigAccept(ALICE_PK, c);
        vm.prank(relayer);
        vault.acceptAndSettle(c, sig);
    }

    function _acceptExpectRevert(UnspentVault.DeliveryAcceptance memory c, bytes memory sig, bytes4 sel) internal {
        vm.prank(relayer);
        vm.expectRevert(sel);
        vault.acceptAndSettle(c, sig);
    }

    function _deposit(address who, uint256 p, uint256 amt) internal {
        usdc.mint(who, amt);
        vm.startPrank(who);
        usdc.approve(address(vault), amt);
        vault.deposit(p, amt);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- views
    function _avail(uint256 p, address who) internal view returns (uint256 a) {
        (a,,,,) = vault.getAccount(p, who);
    }

    function _resv(uint256 p, address who) internal view returns (uint256 r) {
        (, r,,,) = vault.getAccount(p, who);
    }

    function _settled(uint256 p, address who) internal view returns (uint256 s) {
        (,,, s,) = vault.getAccount(p, who);
    }

    function _refunded(uint256 p, address who) internal view returns (uint256 f) {
        (,,,, f) = vault.getAccount(p, who);
    }

    function _deposited(uint256 p, address who) internal view returns (uint256 d) {
        (,, d,,) = vault.getAccount(p, who);
    }

    function _status(uint256 id) internal view returns (uint8) {
        return uint8(vault.getReservation(id).status);
    }

    /// available + reserved + settled + refunded == deposited
    function _assertAccountIdentity(uint256 p, address who) internal view {
        (uint256 a, uint256 r, uint256 d, uint256 s, uint256 f) = vault.getAccount(p, who);
        assertEq(a + r + s + f, d, "account identity");
    }
}
