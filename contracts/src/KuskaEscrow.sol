// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title KuskaEscrow
/// @notice Stablecoin "cash on delivery" escrow for Kuska, on HSK Chain.
/// @dev Implements docs/escrow-interface.md v1 exactly. No Ownable, no setters, no pause.
contract KuskaEscrow is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum State {
        None,
        Funded,
        DeliveryClaimed,
        Disputed,
        Released,
        Refunded
    }

    struct Deal {
        address buyer;
        uint96 amount;
        address seller;
        uint64 deliveryDeadline;
        uint64 claimedAt;
        State state;
    }

    address public immutable token;
    address public immutable arbiter;
    uint64 public immutable disputeWindow;

    mapping(bytes32 => Deal) private _deals;

    bytes32 public constant DEPOSIT_AUTHORIZATION_TYPEHASH = keccak256(
        "DepositAuthorization(bytes32 orderRef,address seller,uint256 amount,uint64 deliveryDeadline,uint256 authDeadline)"
    );
    bytes32 public constant DELIVERY_CLAIM_TYPEHASH = keccak256("DeliveryClaim(bytes32 orderRef,uint256 sigDeadline)");
    bytes32 public constant CANCEL_TYPEHASH = keccak256("Cancel(bytes32 orderRef,uint256 sigDeadline)");
    bytes32 public constant DELIVERY_CONFIRMATION_TYPEHASH =
        keccak256("DeliveryConfirmation(bytes32 orderRef,uint256 sigDeadline)");
    bytes32 public constant DISPUTE_TYPEHASH = keccak256("Dispute(bytes32 orderRef,uint256 sigDeadline)");

    error InvalidState(State current);
    error InvalidSignature();
    error SignatureExpired();
    error InvalidAmount();
    error InvalidAddress();
    error DeliveryDeadlinePassed(); // claim tardío o deliveryDeadline <= now al depositar
    error DeliveryDeadlineNotReached(); // refundExpired temprano
    error DisputeWindowOpen(); // releaseAfterWindow temprano
    error DisputeWindowClosed(); // dispute tardía
    error NotArbiter();

    event Deposited(
        bytes32 indexed orderRef, address indexed buyer, address indexed seller, uint256 amount, uint64 deliveryDeadline
    );
    event DeliveryClaimed(bytes32 indexed orderRef, address indexed seller, uint64 claimedAt);
    event Released(bytes32 indexed orderRef, address indexed seller, uint256 amount, uint8 reason); // 0 buyerConfirmed · 1 windowElapsed · 2 arbiter
    event Refunded(bytes32 indexed orderRef, address indexed buyer, uint256 amount, uint8 reason); // 0 expired · 1 sellerCancel · 2 arbiter
    event Disputed(bytes32 indexed orderRef, address indexed buyer);
    event DisputeResolved(bytes32 indexed orderRef, bool toSeller);

    constructor(address token_, address arbiter_, uint64 disputeWindow_) EIP712("KuskaEscrow", "1") {
        if (token_ == address(0) || arbiter_ == address(0)) revert InvalidAddress();
        // NOTE (deviation from literal interface): the interface requires `disputeWindow > 0`
        // in the constructor but does not name a dedicated error for that case. We reuse
        // InvalidAmount as the closest semantic fit rather than adding an undocumented error.
        if (disputeWindow_ == 0) revert InvalidAmount();
        token = token_;
        arbiter = arbiter_;
        disputeWindow = disputeWindow_;
    }

    function getDeal(bytes32 orderRef) external view returns (Deal memory) {
        return _deals[orderRef];
    }

    function depositWithPermit(
        bytes32 orderRef,
        address buyer,
        address seller,
        uint256 amount,
        uint64 deliveryDeadline,
        uint256 authDeadline,
        bytes calldata authSig,
        uint256 permitDeadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        Deal storage deal = _deals[orderRef];
        if (deal.state != State.None) revert InvalidState(deal.state);
        if (amount == 0 || amount > type(uint96).max) revert InvalidAmount();
        if (buyer == address(0) || seller == address(0) || seller == buyer) revert InvalidAddress();
        if (deliveryDeadline <= block.timestamp) revert DeliveryDeadlinePassed();
        if (block.timestamp > authDeadline) revert SignatureExpired();

        _verifyDepositAuthorization(orderRef, buyer, seller, amount, deliveryDeadline, authDeadline, authSig);

        deal.buyer = buyer;
        deal.amount = uint96(amount);
        deal.seller = seller;
        deal.deliveryDeadline = deliveryDeadline;
        deal.state = State.Funded;

        emit Deposited(orderRef, buyer, seller, amount, deliveryDeadline);

        try IERC20Permit(token).permit(buyer, address(this), amount, permitDeadline, v, r, s) {} catch {}
        IERC20(token).safeTransferFrom(buyer, address(this), amount);
    }

    function _verifyDepositAuthorization(
        bytes32 orderRef,
        address buyer,
        address seller,
        uint256 amount,
        uint64 deliveryDeadline,
        uint256 authDeadline,
        bytes calldata authSig
    ) private view {
        bytes32 structHash = keccak256(
            abi.encode(DEPOSIT_AUTHORIZATION_TYPEHASH, orderRef, seller, amount, deliveryDeadline, authDeadline)
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        if (!SignatureChecker.isValidSignatureNow(buyer, digest, authSig)) revert InvalidSignature();
    }

    function claimDelivery(bytes32 orderRef, uint256 sigDeadline, bytes calldata sellerSig) external {
        Deal storage deal = _deals[orderRef];
        if (deal.state != State.Funded) revert InvalidState(deal.state);
        if (block.timestamp > deal.deliveryDeadline) revert DeliveryDeadlinePassed();
        if (block.timestamp > sigDeadline) revert SignatureExpired();

        bytes32 structHash = keccak256(abi.encode(DELIVERY_CLAIM_TYPEHASH, orderRef, sigDeadline));
        bytes32 digest = _hashTypedDataV4(structHash);
        if (!SignatureChecker.isValidSignatureNow(deal.seller, digest, sellerSig)) revert InvalidSignature();

        deal.claimedAt = uint64(block.timestamp);
        deal.state = State.DeliveryClaimed;

        emit DeliveryClaimed(orderRef, deal.seller, deal.claimedAt);
    }

    function release(bytes32 orderRef, uint256 sigDeadline, bytes calldata buyerSig) external nonReentrant {
        Deal storage deal = _deals[orderRef];
        State current = deal.state;
        if (current != State.Funded && current != State.DeliveryClaimed) revert InvalidState(current);
        if (block.timestamp > sigDeadline) revert SignatureExpired();

        bytes32 structHash = keccak256(abi.encode(DELIVERY_CONFIRMATION_TYPEHASH, orderRef, sigDeadline));
        bytes32 digest = _hashTypedDataV4(structHash);
        if (!SignatureChecker.isValidSignatureNow(deal.buyer, digest, buyerSig)) revert InvalidSignature();

        deal.state = State.Released;
        address seller = deal.seller;
        uint256 amount = deal.amount;

        emit Released(orderRef, seller, amount, 0);

        IERC20(token).safeTransfer(seller, amount);
    }

    function dispute(bytes32 orderRef, uint256 sigDeadline, bytes calldata buyerSig) external {
        Deal storage deal = _deals[orderRef];
        if (deal.state != State.DeliveryClaimed) revert InvalidState(deal.state);
        if (block.timestamp >= uint256(deal.claimedAt) + disputeWindow) revert DisputeWindowClosed();
        if (block.timestamp > sigDeadline) revert SignatureExpired();

        bytes32 structHash = keccak256(abi.encode(DISPUTE_TYPEHASH, orderRef, sigDeadline));
        bytes32 digest = _hashTypedDataV4(structHash);
        if (!SignatureChecker.isValidSignatureNow(deal.buyer, digest, buyerSig)) revert InvalidSignature();

        deal.state = State.Disputed;

        emit Disputed(orderRef, deal.buyer);
    }

    function releaseAfterWindow(bytes32 orderRef) external nonReentrant {
        Deal storage deal = _deals[orderRef];
        if (deal.state != State.DeliveryClaimed) revert InvalidState(deal.state);
        if (block.timestamp < uint256(deal.claimedAt) + disputeWindow) revert DisputeWindowOpen();

        deal.state = State.Released;
        address seller = deal.seller;
        uint256 amount = deal.amount;

        emit Released(orderRef, seller, amount, 1);

        IERC20(token).safeTransfer(seller, amount);
    }

    function refundExpired(bytes32 orderRef) external nonReentrant {
        Deal storage deal = _deals[orderRef];
        if (deal.state != State.Funded) revert InvalidState(deal.state);
        if (block.timestamp <= deal.deliveryDeadline) revert DeliveryDeadlineNotReached();

        deal.state = State.Refunded;
        address buyer = deal.buyer;
        uint256 amount = deal.amount;

        emit Refunded(orderRef, buyer, amount, 0);

        IERC20(token).safeTransfer(buyer, amount);
    }

    function cancel(bytes32 orderRef, uint256 sigDeadline, bytes calldata sellerSig) external nonReentrant {
        Deal storage deal = _deals[orderRef];
        if (deal.state != State.Funded) revert InvalidState(deal.state);
        if (block.timestamp > sigDeadline) revert SignatureExpired();

        bytes32 structHash = keccak256(abi.encode(CANCEL_TYPEHASH, orderRef, sigDeadline));
        bytes32 digest = _hashTypedDataV4(structHash);
        if (!SignatureChecker.isValidSignatureNow(deal.seller, digest, sellerSig)) revert InvalidSignature();

        deal.state = State.Refunded;
        address buyer = deal.buyer;
        uint256 amount = deal.amount;

        emit Refunded(orderRef, buyer, amount, 1);

        IERC20(token).safeTransfer(buyer, amount);
    }

    function resolveDispute(bytes32 orderRef, bool toSeller) external nonReentrant {
        if (msg.sender != arbiter) revert NotArbiter();
        Deal storage deal = _deals[orderRef];
        if (deal.state != State.Disputed) revert InvalidState(deal.state);

        address seller = deal.seller;
        address buyer = deal.buyer;
        uint256 amount = deal.amount;

        emit DisputeResolved(orderRef, toSeller);

        if (toSeller) {
            deal.state = State.Released;
            emit Released(orderRef, seller, amount, 2);
            IERC20(token).safeTransfer(seller, amount);
        } else {
            deal.state = State.Refunded;
            emit Refunded(orderRef, buyer, amount, 2);
            IERC20(token).safeTransfer(buyer, amount);
        }
    }
}
