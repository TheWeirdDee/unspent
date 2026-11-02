// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {UnspentVault} from "../UnspentVault.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// Bounded random-action driver: 3 customers (known keys), 2 providers, warp, outsider attacks.
/// Contains no test_/invariant_ functions (it is only a target).
contract UnspentVaultHandler is Test {
    UnspentVault public vault;
    MockUSDC public usdc;

    uint256[3] internal customerPks = [uint256(0xA11CE), uint256(0xB0B), uint256(0xCA401)];
    uint256 internal constant OUTSIDER_PK = 0x9701;
    address[3] public customers;
    uint256[2] public providerIds;
    address[2] public providerOwners;
    address[] public payoutWallets; // every wallet that has ever been a payout destination

    uint256[] public reservationIds;
    uint256 public ghostDeposited;
    uint256 public ghostRefunded;
    uint256 public ghostSettled;
    bool public outsiderReducedAvailable;
    uint256 internal nonceCounter;

    uint256 public nDeposit;
    uint256 public nRefund;
    uint256 public nReserve;
    uint256 public nSettleDirect;
    uint256 public nSettleSigned;
    uint256 public nRelease;
    uint256 public nOutsider;

    constructor(UnspentVault vault_, MockUSDC usdc_) {
        vault = vault_;
        usdc = usdc_;
        for (uint256 i; i < 3; i++) {
            customers[i] = vm.addr(customerPks[i]);
        }
        providerOwners[0] = makeAddr("handlerOwnerA");
        providerOwners[1] = makeAddr("handlerOwnerB");
        for (uint256 i; i < 2; i++) {
            address w = makeAddr(i == 0 ? "handlerPayoutA" : "handlerPayoutB");
            payoutWallets.push(w);
            vm.prank(providerOwners[i]);
            providerIds[i] = vault.registerProvider(w, keccak256(abi.encode(i)));
        }
    }

    function payoutCount() external view returns (uint256) {
        return payoutWallets.length;
    }

    function reservationCount() external view returns (uint256) {
        return reservationIds.length;
    }

    // ------------------------------------------------------------ helpers
    function _c(uint256 seed) internal view returns (uint256 i, address c) {
        i = seed % 3;
        c = customers[i];
    }

    function _p(uint256 seed) internal view returns (uint256 p) {
        p = providerIds[seed % 2];
    }

    // ------------------------------------------------------------ actions
    function deposit(uint256 cSeed, uint256 pSeed, uint256 amount) external {
        (, address c) = _c(cSeed);
        uint256 p = _p(pSeed);
        amount = bound(amount, 1, 1e13);
        usdc.mint(c, amount);
        vm.startPrank(c);
        usdc.approve(address(vault), amount);
        try vault.deposit(p, amount) {
            ghostDeposited += amount;
            nDeposit++;
        } catch {}
        vm.stopPrank();
    }

    function refund(uint256 cSeed, uint256 pSeed, uint256 amount) external {
        (, address c) = _c(cSeed);
        uint256 p = _p(pSeed);
        (uint256 avail,,,,) = vault.getAccount(p, c);
        if (avail == 0) return;
        amount = bound(amount, 1, avail);
        vm.prank(c);
        vault.refund(p, amount);
        ghostRefunded += amount;
        nRefund++;
    }

    function reserve(uint256 cSeed, uint256 pSeed, uint256 amount, uint256 duration) external {
        (uint256 ci, address c) = _c(cSeed);
        uint256 p = _p(pSeed);
        (uint256 avail,,,,) = vault.getAccount(p, c);
        if (avail == 0) return;
        UnspentVault.Provider memory prov = vault.getProvider(p);
        if (!prov.active) return;
        duration = bound(duration, 2, 1 days);
        nonceCounter++;
        UnspentVault.ReserveAuthorisation memory a = UnspentVault.ReserveAuthorisation({
            customer: c,
            providerId: p,
            payoutWallet: prov.payoutWallet,
            payoutVersion: prov.payoutVersion,
            requestHash: keccak256(abi.encode("r", nonceCounter)),
            maxAmount: bound(amount, 1, avail),
            nonce: nonceCounter,
            authDeadline: block.timestamp + duration / 2,
            expiry: block.timestamp + duration,
            providerSettleAfter: 0
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(customerPks[ci], vault.hashReserveAuthorisation(a));
        uint256 id = vault.reserveWithSignature(a, abi.encodePacked(r, s, v));
        reservationIds.push(id);
        nReserve++;
    }

    function settle(uint256 idxSeed, uint256 amountSeed, uint256 mode) external {
        if (reservationIds.length == 0) return;
        uint256 id = reservationIds[idxSeed % reservationIds.length];
        UnspentVault.Reservation memory r = vault.getReservation(id);
        if (r.status != UnspentVault.ReservationStatus.Reserved || block.timestamp >= r.expiry) return;
        uint256 amount = bound(amountSeed, 1, r.maxAmount);
        bytes32 resp = keccak256(abi.encode("resp", id, amountSeed));
        if (mode % 2 == 0) {
            vm.prank(r.customer);
            vault.settleDirect(id, resp, amount);
            nSettleDirect++;
        } else {
            uint256 pk = _pkOf(r.customer);
            nonceCounter++;
            UnspentVault.DeliveryAcceptance memory acc = UnspentVault.DeliveryAcceptance({
                customer: r.customer,
                reservationId: id,
                responseHash: resp,
                amount: amount,
                nonce: nonceCounter,
                deadline: block.timestamp
            });
            (uint8 v, bytes32 rr, bytes32 ss) = vm.sign(pk, vault.hashDeliveryAcceptance(acc));
            vault.acceptAndSettle(acc, abi.encodePacked(rr, ss, v));
            nSettleSigned++;
        }
        ghostSettled += amount;
    }

    function release(uint256 idxSeed) external {
        if (reservationIds.length == 0) return;
        uint256 id = reservationIds[idxSeed % reservationIds.length];
        UnspentVault.Reservation memory r = vault.getReservation(id);
        if (r.status != UnspentVault.ReservationStatus.Reserved || block.timestamp < r.expiry) return;
        vault.releaseExpired(id);
        nRelease++;
    }

    function warp(uint256 delta) external {
        vm.warp(block.timestamp + bound(delta, 1, 12 hours));
    }

    function updatePayout(uint256 pSeed) external {
        uint256 i = pSeed % 2;
        address w = address(uint160(0xC0FFEE00 + payoutWallets.length));
        payoutWallets.push(w);
        vm.prank(providerOwners[i]);
        vault.updateProviderPayout(providerIds[i], w);
    }

    function toggleActive(uint256 pSeed, uint256 flag) external {
        uint256 i = pSeed % 2;
        vm.prank(providerOwners[i]);
        vault.setProviderActive(providerIds[i], flag % 4 != 0); // mostly active
    }

    /// Provider owners, payout wallets and random addresses try every state-changing entry point.
    /// Nothing they do may reduce any customer's available balance.
    function outsiderAttack(uint256 whoSeed, uint256 idxSeed, uint256 amount, uint256 kind) external {
        nOutsider++;
        address who;
        uint256 sel = whoSeed % 4;
        if (sel == 0) who = providerOwners[0];
        else if (sel == 1) who = providerOwners[1];
        else if (sel == 2) who = payoutWallets[whoSeed % payoutWallets.length];
        else who = address(uint160(bound(whoSeed, 1, type(uint160).max)));
        for (uint256 i; i < 3; i++) {
            if (who == customers[i]) return; // customers acting on themselves are covered elsewhere
        }

        uint256[6] memory before_ = _availableSnapshot();
        uint256 p = _p(idxSeed);
        amount = bound(amount, 1, 1e13);
        uint256 id = reservationIds.length == 0 ? 1 : reservationIds[idxSeed % reservationIds.length];
        UnspentVault.Reservation memory r = vault.getReservation(id);
        uint256 k = kind % 5;

        vm.startPrank(who);
        if (k == 0) {
            try vault.refund(p, amount) {} catch {}
        } else if (k == 1) {
            try vault.settleDirect(id, keccak256("x"), amount) {} catch {}
        } else if (k == 2 && r.customer != address(0)) {
            UnspentVault.DeliveryAcceptance memory acc = UnspentVault.DeliveryAcceptance({
                customer: r.customer,
                reservationId: id,
                responseHash: keccak256("x"),
                amount: amount,
                nonce: ++nonceCounter,
                deadline: block.timestamp
            });
            (uint8 v, bytes32 rr, bytes32 ss) = vm.sign(OUTSIDER_PK, vault.hashDeliveryAcceptance(acc));
            try vault.acceptAndSettle(acc, abi.encodePacked(rr, ss, v)) {} catch {}
        } else if (k == 3) {
            UnspentVault.Provider memory prov = vault.getProvider(p);
            UnspentVault.ReserveAuthorisation memory a = UnspentVault.ReserveAuthorisation({
                customer: customers[idxSeed % 3],
                providerId: p,
                payoutWallet: prov.payoutWallet,
                payoutVersion: prov.payoutVersion,
                requestHash: keccak256(abi.encode("o", ++nonceCounter)),
                maxAmount: amount,
                nonce: nonceCounter,
                authDeadline: block.timestamp + 1,
                expiry: block.timestamp + 2,
                providerSettleAfter: 0
            });
            (uint8 v, bytes32 rr, bytes32 ss) = vm.sign(OUTSIDER_PK, vault.hashReserveAuthorisation(a));
            try vault.reserveWithSignature(a, abi.encodePacked(rr, ss, v)) {} catch {}
        } else {
            try vault.releaseExpired(id) {} catch {} // only ever increases available
        }
        vm.stopPrank();

        uint256[6] memory after_ = _availableSnapshot();
        for (uint256 i; i < 6; i++) {
            if (after_[i] < before_[i]) outsiderReducedAvailable = true;
        }
    }

    // ------------------------------------------------------------ internals
    function _availableSnapshot() internal view returns (uint256[6] memory snap) {
        for (uint256 c; c < 3; c++) {
            for (uint256 p; p < 2; p++) {
                (snap[c * 2 + p],,,,) = vault.getAccount(providerIds[p], customers[c]);
            }
        }
    }

    function _pkOf(address c) internal view returns (uint256) {
        for (uint256 i; i < 3; i++) {
            if (customers[i] == c) return customerPks[i];
        }
        revert("unknown customer");
    }
}
