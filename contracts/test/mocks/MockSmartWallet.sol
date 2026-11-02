// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Minimal ERC-1271 contract wallet for tests. It can execute calls on behalf of itself,
/// so it behaves like a customer that is a contract (a Safe-style wallet) rather than an EOA.
/// The validation mode is switchable so every failure branch of the vault can be exercised.
contract MockSmartWallet is IERC1271 {
    enum Mode {
        EcdsaOwner, // validate an ECDSA signature against `owner` (the normal path)
        AlwaysAccept, // accept anything: the vault must still bind it to this address
        AlwaysReject, // return the wrong magic value
        Revert, // revert inside the callback
        ShortReturn // return fewer than 32 bytes
    }

    address public immutable owner;
    Mode public mode;

    error NotOwner();
    error CallFailed();

    constructor(address owner_) {
        owner = owner_;
    }

    function setMode(Mode m) external {
        if (msg.sender != owner) revert NotOwner();
        mode = m;
    }

    function execute(address target, bytes calldata data) external returns (bytes memory) {
        if (msg.sender != owner) revert NotOwner();
        (bool ok, bytes memory ret) = target.call(data);
        if (!ok) revert CallFailed();
        return ret;
    }

    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4) {
        if (mode == Mode.Revert) revert("wallet says no");
        if (mode == Mode.ShortReturn) {
            assembly {
                mstore(0x00, 0x1626ba7e00000000000000000000000000000000000000000000000000000000)
                return(0x00, 0x04)
            }
        }
        if (mode == Mode.AlwaysReject) return bytes4(0xffffffff);
        if (mode == Mode.AlwaysAccept) return IERC1271.isValidSignature.selector;
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, signature);
        if (err != ECDSA.RecoverError.NoError || signer != owner) return bytes4(0xffffffff);
        return IERC1271.isValidSignature.selector;
    }
}
