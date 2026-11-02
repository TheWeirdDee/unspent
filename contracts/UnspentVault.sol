// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title UnspentVault
/// @notice Immutable, adminless vault for refundable, provider-scoped prepaid API credits.
/// @dev All monetary values are integer micro-USDC (6 decimals). No owner, pause,
/// upgrade, rescue or sweep exists. Provider owners control only their own registry
/// configuration, never customer balances. Signatures accept EOA ECDSA (65-byte) and
/// ERC-1271 contract-wallet signatures; a contract customer is checked with
/// isValidSignature and no other code path trusts the returned address.
/// Payout destinations are bound when reserving, even if the provider later changes
/// its configuration. Withholding acceptance exposes providers to nonpayment risk;
/// a customer may opt in, per reservation, to a bounded window after which the
/// provider can claim settlement without a fresh signature ("consent settlement").
/// That opt-in is signed at reservation time, so it is explicit, capped by maxAmount
/// and expires with the reservation; it is not a default and cannot be turned on by
/// the provider. A response hash records customer consent, NOT proof of off-chain
/// service quality, and a consent settlement records the provider's claim only.
/// The configured asset must behave as non-rebasing, exact-transfer USDC. Issuer or
/// network restrictions may prevent transfers. Direct token transfers and forced
/// native sends (including Arc native-USDC surplus) never create credits and cannot
/// be swept. There is no payable receive/fallback or native-asset withdrawal path.
/// Account invariant: available + reserved + totalSettled + totalRefunded equals
/// totalDeposited. Outstanding liability equals aggregate available plus reserved;
/// token balance must cover liability under the stated token-behaviour assumption.
contract UnspentVault is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Provider {
        address owner;
        address payoutWallet;
        uint32 payoutVersion;
        bool active;
        bytes32 metadataHash;
    }

    struct Account {
        uint256 available;
        uint256 reserved;
        uint256 totalDeposited;
        uint256 totalSettled;
        uint256 totalRefunded;
    }

    enum ReservationStatus { None, Reserved, Settled, Released }

    struct Reservation {
        address customer;
        uint64 providerId;
        address payoutWallet;
        uint32 payoutVersion;
        ReservationStatus status;
        uint64 expiry;
        uint256 maxAmount;
        bytes32 requestHash;
        bytes32 responseHash;
        uint256 settledAmount;
        uint64 providerSettleAfter;
    }

    struct ReserveAuthorisation {
        address customer;
        uint256 providerId;
        address payoutWallet;
        uint32 payoutVersion;
        bytes32 requestHash;
        uint256 maxAmount;
        uint256 nonce;
        uint256 authDeadline;
        uint256 expiry;
        /// @dev Zero means customer-signature settlement only (the default).
        uint64 providerSettleAfter;
    }

    struct DeliveryAcceptance {
        address customer;
        uint256 reservationId;
        bytes32 responseHash;
        uint256 amount;
        uint256 nonce;
        uint256 deadline;
    }

    error ZeroAddress();
    error InvalidPayoutWallet();
    error ZeroAmount();
    error ProviderNotFound();
    error ProviderInactive();
    error NotProviderOwner();
    error ProviderIdOverflow();
    error TransferAmountMismatch();
    error PayoutConfigMismatch();
    error InvalidRequestHash();
    error AuthorisationExpired();
    error InvalidExpiryRelationship();
    error ExpiryTooFar();
    error InvalidSignature();
    error NonceUsed();
    error RequestAlreadyReserved();
    error InsufficientAvailable();
    error ReservationNotOpen();
    error NotCustomer();
    error AcceptanceExpired();
    error ReservationExpired();
    error InvalidResponseHash();
    error AmountExceedsReservation();
    error ReservationNotExpired();
    error InvalidSettlementConsent();
    error NoSettlementConsent();
    error ConsentWindowNotOpen();

    event ProviderRegistered(uint256 indexed providerId, address indexed owner, address payoutWallet, bytes32 metadataHash);
    event ProviderPayoutUpdated(uint256 indexed providerId, address oldPayout, address newPayout, uint32 version);
    event ProviderStatusChanged(uint256 indexed providerId, bool active);
    event CreditsDeposited(uint256 indexed providerId, address indexed customer, uint256 amount);
    event UsageReserved(uint256 indexed reservationId, uint256 indexed providerId, address indexed customer, uint256 amount, uint256 expiry, bytes32 requestHash);
    event UsageSettled(uint256 indexed reservationId, uint256 indexed providerId, address indexed customer, uint256 amount, bytes32 responseHash, address payoutWallet);
    event ReservationReleased(uint256 indexed reservationId, uint256 indexed providerId, address indexed customer, uint256 amount);
    event CreditsRefunded(uint256 indexed providerId, address indexed customer, uint256 amount);
    /// @notice A settlement paid under the customer's signed consent window, not a fresh acceptance.
    event ConsentSettlement(uint256 indexed reservationId, uint256 indexed providerId, address indexed customer);

    /// @notice Maximum reservation lifetime measured from submission time, in seconds.
    uint256 public constant MAX_RESERVATION_DURATION = 1 days;
    /// @notice Exact EIP-712 reserve schema, including the signed submission deadline.
    bytes32 public constant RESERVE_AUTHORISATION_TYPEHASH = keccak256(
        "ReserveAuthorisation(address customer,uint256 providerId,address payoutWallet,uint32 payoutVersion,bytes32 requestHash,uint256 maxAmount,uint256 nonce,uint256 authDeadline,uint256 expiry,uint64 providerSettleAfter)"
    );
    /// @notice Exact EIP-712 delivery-acceptance schema.
    bytes32 public constant DELIVERY_ACCEPTANCE_TYPEHASH = keccak256(
        "DeliveryAcceptance(address customer,uint256 reservationId,bytes32 responseHash,uint256 amount,uint256 nonce,uint256 deadline)"
    );
    /// @notice Immutable ERC-20 interface used for all USDC accounting and transfers.
    IERC20 public immutable usdc;
    /// @notice Provider configuration by immutable provider ID; zero owner means absent.
    mapping(uint256 => Provider) public providers;
    mapping(uint256 => mapping(address => Account)) private accounts;
    mapping(uint256 => Reservation) private reservations;
    /// @notice Next provider ID, starting at one.
    uint256 public nextProviderId = 1;
    /// @notice Next reservation ID, starting at one.
    uint256 public nextReservationId = 1;
    /// @notice Customer-scoped used reserve nonces.
    mapping(address => mapping(uint256 => bool)) public usedReserveNonce;
    /// @notice Customer-scoped used acceptance nonces, independent of reserve nonces.
    mapping(address => mapping(uint256 => bool)) public usedAcceptanceNonce;
    /// @notice Permanent customer/request replay protection, retained after release or settlement.
    mapping(address => mapping(bytes32 => bool)) public requestReserved;
    /// @notice Sum of available and reserved balances across all accounts.
    uint256 public totalOutstandingLiability;
    /// @notice Sum of available and reserved balances for each provider.
    mapping(uint256 => uint256) public providerOutstanding;

    /// @notice Creates the vault without any administrator or upgrade authority.
    /// @param usdc_ Nonzero USDC ERC-20 interface; no address or chain is hardcoded.
    constructor(IERC20 usdc_) EIP712("UnspentVault", "1") {
        if (address(usdc_) == address(0)) revert ZeroAddress();
        usdc = usdc_;
    }

    /// @notice Registers the caller as a provider owner with an active payout configuration.
    /// @param payoutWallet Nonzero destination for future reserved payments.
    /// @param metadataHash Hash of off-chain provider metadata.
    /// @return providerId Newly allocated immutable provider identifier.
    function registerProvider(address payoutWallet, bytes32 metadataHash) external returns (uint256 providerId) {
        _checkPayout(payoutWallet);
        providerId = nextProviderId;
        if (providerId > type(uint64).max) revert ProviderIdOverflow();
        nextProviderId = providerId + 1;
        providers[providerId] = Provider(msg.sender, payoutWallet, 1, true, metadataHash);
        emit ProviderRegistered(providerId, msg.sender, payoutWallet, metadataHash);
    }

    /// @notice Updates only the caller-owned provider's future payout configuration.
    /// @dev Existing reservations retain their bound payout. Version increments use checked math.
    function updateProviderPayout(uint256 providerId, address newPayout) external {
        Provider storage provider = _ownedProvider(providerId);
        _checkPayout(newPayout);
        address oldPayout = provider.payoutWallet;
        provider.payoutWallet = newPayout;
        provider.payoutVersion++;
        emit ProviderPayoutUpdated(providerId, oldPayout, newPayout, provider.payoutVersion);
    }

    /// @notice Enables or disables only new deposits and reservations for a caller-owned provider.
    /// @dev Never blocks refunds, expiry releases or existing-reservation settlement.
    function setProviderActive(uint256 providerId, bool active) external {
        Provider storage provider = _ownedProvider(providerId);
        provider.active = active;
        emit ProviderStatusChanged(providerId, active);
    }

    /// @notice Pulls USDC from the caller and atomically issues provider-specific credits.
    /// @dev Pull precedes accounting so exact received delta can be checked under nonReentrant.
    /// Fee-on-transfer receipts are rejected; surplus never counts as a deposit.
    function deposit(uint256 providerId, uint256 amount) external nonReentrant {
        _activeProvider(providerId);
        if (amount == 0) revert ZeroAmount();
        uint256 beforeBalance = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        uint256 afterBalance = usdc.balanceOf(address(this));
        if (afterBalance < beforeBalance || afterBalance - beforeBalance != amount) revert TransferAmountMismatch();
        Account storage account = accounts[providerId][msg.sender];
        account.available += amount;
        account.totalDeposited += amount;
        totalOutstandingLiability += amount;
        providerOutstanding[providerId] += amount;
        emit CreditsDeposited(providerId, msg.sender, amount);
    }

    /// @notice Returns the full chain-and-contract-bound EIP-712 reserve digest.
    /// @dev All struct members are static ABI types; tuple encoding preserves the exact schema order.
    function hashReserveAuthorisation(ReserveAuthorisation calldata auth) public view returns (bytes32 digest) {
        return _hashTypedDataV4(keccak256(abi.encode(RESERVE_AUTHORISATION_TYPEHASH, auth)));
    }

    /// @notice Allows any relayer to reserve credits using the customer's EOA signature.
    /// @dev Submission at authDeadline is valid. Expiry must exceed that signed deadline
    /// and be no more than one day after submission. Customer/request hashes cannot be reused.
    /// @return reservationId Newly allocated reservation identifier.
    function reserveWithSignature(ReserveAuthorisation calldata auth, bytes calldata signature)
        external nonReentrant returns (uint256 reservationId)
    {
        Provider storage provider = _activeProvider(auth.providerId);
        if (auth.payoutWallet != provider.payoutWallet || auth.payoutVersion != provider.payoutVersion) {
            revert PayoutConfigMismatch();
        }
        if (auth.customer == address(0)) revert ZeroAddress();
        if (auth.maxAmount == 0) revert ZeroAmount();
        if (auth.requestHash == bytes32(0)) revert InvalidRequestHash();
        if (block.timestamp > auth.authDeadline) revert AuthorisationExpired();
        if (auth.expiry <= auth.authDeadline) revert InvalidExpiryRelationship();
        if (auth.expiry > block.timestamp + MAX_RESERVATION_DURATION || auth.expiry > type(uint64).max) {
            revert ExpiryTooFar();
        }
        // A consent window must open after the signed submission deadline and close before expiry, so the
        // customer keeps a real acceptance window and the provider never gains time beyond the reservation.
        if (auth.providerSettleAfter != 0) {
            if (auth.providerSettleAfter <= auth.authDeadline || auth.providerSettleAfter >= auth.expiry) {
                revert InvalidSettlementConsent();
            }
        }
        _verifySignature(hashReserveAuthorisation(auth), signature, auth.customer);
        if (usedReserveNonce[auth.customer][auth.nonce]) revert NonceUsed();
        usedReserveNonce[auth.customer][auth.nonce] = true;
        if (requestReserved[auth.customer][auth.requestHash]) revert RequestAlreadyReserved();
        Account storage account = accounts[auth.providerId][auth.customer];
        if (account.available < auth.maxAmount) revert InsufficientAvailable();
        requestReserved[auth.customer][auth.requestHash] = true;
        account.available -= auth.maxAmount;
        account.reserved += auth.maxAmount;
        reservationId = nextReservationId++;
        Reservation storage reservation = reservations[reservationId];
        reservation.customer = auth.customer;
        // Registration caps provider IDs at uint64.max, so the narrowing is lossless.
        reservation.providerId = uint64(auth.providerId);
        reservation.payoutWallet = auth.payoutWallet;
        reservation.payoutVersion = auth.payoutVersion;
        reservation.status = ReservationStatus.Reserved;
        reservation.expiry = uint64(auth.expiry);
        reservation.maxAmount = auth.maxAmount;
        reservation.requestHash = auth.requestHash;
        reservation.providerSettleAfter = auth.providerSettleAfter;
        emit UsageReserved(reservationId, auth.providerId, auth.customer, auth.maxAmount, auth.expiry, auth.requestHash);
    }

    /// @notice Returns the full chain-and-contract-bound EIP-712 delivery-acceptance digest.
    function hashDeliveryAcceptance(DeliveryAcceptance calldata acc) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(DELIVERY_ACCEPTANCE_TYPEHASH, acc)));
    }

    /// @notice Allows any relayer to settle with customer-signed acceptance before reservation expiry.
    /// @dev Acceptance deadline is inclusive; reservation expiry is exclusive. Nonces
    /// are customer-scoped. A failed transfer rolls back nonce use and all accounting.
    function acceptAndSettle(DeliveryAcceptance calldata acc, bytes calldata signature) external nonReentrant {
        Reservation storage reservation = _openReservation(acc.reservationId);
        if (acc.customer != reservation.customer) revert NotCustomer();
        if (block.timestamp > acc.deadline) revert AcceptanceExpired();
        _validateSettlement(reservation, acc.responseHash, acc.amount);
        _verifySignature(hashDeliveryAcceptance(acc), signature, acc.customer);
        if (usedAcceptanceNonce[acc.customer][acc.nonce]) revert NonceUsed();
        usedAcceptanceNonce[acc.customer][acc.nonce] = true;
        _settle(acc.reservationId, reservation, acc.responseHash, acc.amount);
    }

    /// @notice Lets the reservation customer directly accept and settle without a signature or nonce.
    /// @dev Settlement always pays the wallet bound at reservation, even for inactive providers.
    function settleDirect(uint256 reservationId, bytes32 responseHash, uint256 amount) external nonReentrant {
        Reservation storage reservation = _openReservation(reservationId);
        if (msg.sender != reservation.customer) revert NotCustomer();
        _validateSettlement(reservation, responseHash, amount);
        _settle(reservationId, reservation, responseHash, amount);
    }

    /// @notice Claims a reservation the customer explicitly opted into settling without a fresh signature.
    /// @dev Only the provider's registry owner may call, only inside the window the customer signed, and only
    /// while the reservation is still open. The response hash is the provider's claim: this path records that a
    /// provider asserted delivery, not that the customer accepted it. A customer who wants to keep control must
    /// not sign a non-zero providerSettleAfter in the first place.
    function settleConsented(uint256 reservationId, bytes32 responseHash, uint256 amount) external nonReentrant {
        Reservation storage reservation = _openReservation(reservationId);
        uint64 consentTime = reservation.providerSettleAfter;
        if (consentTime == 0) revert NoSettlementConsent();
        if (block.timestamp < consentTime) revert ConsentWindowNotOpen();
        if (providers[reservation.providerId].owner != msg.sender) revert NotProviderOwner();
        _validateSettlement(reservation, responseHash, amount);
        _settle(reservationId, reservation, responseHash, amount);
        emit ConsentSettlement(reservationId, reservation.providerId, reservation.customer);
    }

    /// @notice Returns an expired reservation to its customer's available credits; any caller may submit.
    /// @dev Allowed exactly at expiry, never earlier. No token transfer or liability change occurs.
    function releaseExpired(uint256 reservationId) external nonReentrant {
        Reservation storage reservation = _openReservation(reservationId);
        if (block.timestamp < reservation.expiry) revert ReservationNotExpired();
        reservation.status = ReservationStatus.Released;
        Account storage account = accounts[reservation.providerId][reservation.customer];
        account.reserved -= reservation.maxAmount;
        account.available += reservation.maxAmount;
        emit ReservationReleased(reservationId, reservation.providerId, reservation.customer, reservation.maxAmount);
    }

    /// @notice Refunds only the caller's available credits directly to the caller's wallet.
    /// @dev Registry active status is irrelevant. Reserved and previously settled funds cannot be refunded.
    function refund(uint256 providerId, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Account storage account = accounts[providerId][msg.sender];
        if (amount > account.available) revert InsufficientAvailable();
        account.available -= amount;
        account.totalRefunded += amount;
        totalOutstandingLiability -= amount;
        providerOutstanding[providerId] -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit CreditsRefunded(providerId, msg.sender, amount);
    }

    /// @notice Reads current provider configuration; absent IDs return a zero-valued struct.
    function getProvider(uint256 providerId) external view returns (Provider memory) {
        return providers[providerId];
    }

    /// @notice Reads the five account totals, in integer micro-USDC, for a provider/customer pair.
    function getAccount(uint256 providerId, address customer) external view returns (
        uint256 available, uint256 reserved, uint256 totalDeposited, uint256 totalSettled, uint256 totalRefunded
    ) {
        Account storage account = accounts[providerId][customer];
        return (account.available, account.reserved, account.totalDeposited, account.totalSettled, account.totalRefunded);
    }

    /// @notice Reads complete reservation state; absent IDs return status None and zero fields.
    function getReservation(uint256 reservationId) external view returns (Reservation memory) {
        return reservations[reservationId];
    }

    /// @notice Reports whether the customer's reserve nonce has been consumed.
    function reserveNonceUsed(address customer, uint256 nonce) external view returns (bool) {
        return usedReserveNonce[customer][nonce];
    }

    /// @notice Reports whether the customer's delivery-acceptance nonce has been consumed.
    function acceptanceNonceUsed(address customer, uint256 nonce) external view returns (bool) {
        return usedAcceptanceNonce[customer][nonce];
    }

    /// @notice Returns the current EIP-712 domain separator, including chain ID and vault address.
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice Returns actual ERC-20 token balance and accounted outstanding liability for comparison.
    /// @dev Surplus from unsolicited transfers or forced Arc native sends is not customer credit.
    function solvency() external view returns (uint256 tokenBalance, uint256 liability) {
        return (usdc.balanceOf(address(this)), totalOutstandingLiability);
    }

    /// @dev Payout may not be zero, the vault itself (a self-transfer would burn credit
    /// without paying anyone) or the token contract.
    function _checkPayout(address wallet) private view {
        if (wallet == address(0)) revert ZeroAddress();
        if (wallet == address(this) || wallet == address(usdc)) revert InvalidPayoutWallet();
    }

    function _activeProvider(uint256 providerId) private view returns (Provider storage provider) {
        provider = providers[providerId];
        if (provider.owner == address(0)) revert ProviderNotFound();
        if (!provider.active) revert ProviderInactive();
    }

    function _ownedProvider(uint256 providerId) private view returns (Provider storage provider) {
        provider = providers[providerId];
        if (provider.owner == address(0)) revert ProviderNotFound();
        if (provider.owner != msg.sender) revert NotProviderOwner();
    }

    function _openReservation(uint256 reservationId) private view returns (Reservation storage reservation) {
        reservation = reservations[reservationId];
        if (reservation.status != ReservationStatus.Reserved) revert ReservationNotOpen();
    }

    /// @dev EOA signatures use ECDSA; a customer with code is checked through ERC-1271. The low-level call keeps a
    /// non-conforming wallet from reverting with its own error, and every failure path maps to InvalidSignature.
    function _verifySignature(bytes32 digest, bytes calldata signature, address customer) private view {
        if (customer.code.length > 0) {
            (bool ok, bytes memory result) =
                customer.staticcall(abi.encodeCall(IERC1271.isValidSignature, (digest, signature)));
            if (!ok || result.length < 32 || bytes4(result) != IERC1271.isValidSignature.selector) {
                revert InvalidSignature();
            }
            return;
        }
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        if (err != ECDSA.RecoverError.NoError || signer != customer || signer == address(0)) {
            revert InvalidSignature();
        }
    }

    function _validateSettlement(Reservation storage reservation, bytes32 responseHash, uint256 amount) private view {
        if (block.timestamp >= reservation.expiry) revert ReservationExpired();
        if (responseHash == bytes32(0)) revert InvalidResponseHash();
        if (amount == 0 || amount > reservation.maxAmount) revert AmountExceedsReservation();
    }

    function _settle(uint256 reservationId, Reservation storage reservation, bytes32 responseHash, uint256 amount) private {
        reservation.status = ReservationStatus.Settled;
        reservation.responseHash = responseHash;
        reservation.settledAmount = amount;
        Account storage account = accounts[reservation.providerId][reservation.customer];
        account.reserved -= reservation.maxAmount;
        account.available += reservation.maxAmount - amount;
        account.totalSettled += amount;
        totalOutstandingLiability -= amount;
        providerOutstanding[reservation.providerId] -= amount;
        usdc.safeTransfer(reservation.payoutWallet, amount);
        emit UsageSettled(reservationId, reservation.providerId, reservation.customer, amount, responseHash, reservation.payoutWallet);
    }
}
