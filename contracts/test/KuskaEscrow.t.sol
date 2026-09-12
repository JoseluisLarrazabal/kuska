// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockUSD} from "../src/MockUSD.sol";
import {KuskaEscrow} from "../src/KuskaEscrow.sol";
import {ERC1271WalletMock} from "@openzeppelin/contracts/mocks/ERC1271WalletMock.sol";

contract KuskaEscrowTest is Test {
    // ---- EIP-712 type hashes (mirrored from the interface / contract, reconstructed here
    // independently so the tests exercise the real signing path, not the contract's constants).
    bytes32 constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 constant DEPOSIT_AUTHORIZATION_TYPEHASH = keccak256(
        "DepositAuthorization(bytes32 orderRef,address seller,uint256 amount,uint64 deliveryDeadline,uint256 authDeadline)"
    );
    bytes32 constant DELIVERY_CLAIM_TYPEHASH = keccak256("DeliveryClaim(bytes32 orderRef,uint256 sigDeadline)");
    bytes32 constant CANCEL_TYPEHASH = keccak256("Cancel(bytes32 orderRef,uint256 sigDeadline)");
    bytes32 constant DELIVERY_CONFIRMATION_TYPEHASH =
        keccak256("DeliveryConfirmation(bytes32 orderRef,uint256 sigDeadline)");
    bytes32 constant DISPUTE_TYPEHASH = keccak256("Dispute(bytes32 orderRef,uint256 sigDeadline)");
    bytes32 constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    uint64 constant DISPUTE_WINDOW = 90;
    uint256 constant DEFAULT_AMOUNT = 100e6;

    MockUSD token;
    KuskaEscrow escrow;

    uint256 buyerPk = 0xB0714;
    uint256 sellerPk = 0x5E11E12;
    uint256 arbiterPk = 0xA231BE12;
    uint256 strangerPk = 0x57A4CE12;

    address buyer;
    address seller;
    address arbiter;
    address stranger;

    function setUp() public {
        buyer = vm.addr(buyerPk);
        seller = vm.addr(sellerPk);
        arbiter = vm.addr(arbiterPk);
        stranger = vm.addr(strangerPk);

        token = new MockUSD();
        escrow = new KuskaEscrow(address(token), arbiter, DISPUTE_WINDOW);

        // Fund the buyer with plenty of mUSD so tests can perform multiple deposits without
        // fighting the faucet's 1h cooldown (which is exercised separately in
        // test_Faucet_CooldownAndReset using an unrelated address).
        deal(address(token), buyer, 1_000_000e6);
    }

    // ---------------------------------------------------------------------
    // signing helpers
    // ---------------------------------------------------------------------

    function _domainSeparator(address verifyingContract, string memory name) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes(name)),
                keccak256(bytes("1")),
                block.chainid,
                verifyingContract
            )
        );
    }

    function _hashTypedData(address verifyingContract, string memory name, bytes32 structHash)
        internal
        view
        returns (bytes32)
    {
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(verifyingContract, name), structHash));
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _escrowDigest(bytes32 structHash) internal view returns (bytes32) {
        return _hashTypedData(address(escrow), "KuskaEscrow", structHash);
    }

    function _signDeposit(
        uint256 pk,
        bytes32 orderRef,
        address seller_,
        uint256 amount,
        uint64 deliveryDeadline,
        uint256 authDeadline
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(DEPOSIT_AUTHORIZATION_TYPEHASH, orderRef, seller_, amount, deliveryDeadline, authDeadline)
        );
        return _sign(pk, _escrowDigest(structHash));
    }

    function _signClaim(uint256 pk, bytes32 orderRef, uint256 sigDeadline) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(DELIVERY_CLAIM_TYPEHASH, orderRef, sigDeadline));
        return _sign(pk, _escrowDigest(structHash));
    }

    function _signCancel(uint256 pk, bytes32 orderRef, uint256 sigDeadline) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(CANCEL_TYPEHASH, orderRef, sigDeadline));
        return _sign(pk, _escrowDigest(structHash));
    }

    function _signConfirmation(uint256 pk, bytes32 orderRef, uint256 sigDeadline) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(DELIVERY_CONFIRMATION_TYPEHASH, orderRef, sigDeadline));
        return _sign(pk, _escrowDigest(structHash));
    }

    function _signDispute(uint256 pk, bytes32 orderRef, uint256 sigDeadline) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(DISPUTE_TYPEHASH, orderRef, sigDeadline));
        return _sign(pk, _escrowDigest(structHash));
    }

    function _signPermit(uint256 ownerPk, address owner, address spender, uint256 value, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        uint256 nonce = token.nonces(owner);
        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonce, deadline));
        bytes32 digest = _hashTypedData(address(token), "Kuska Demo USD", structHash);
        (v, r, s) = vm.sign(ownerPk, digest);
    }

    // ---------------------------------------------------------------------
    // deposit helper (funds a standard deal, leaves it in `Funded` state)
    // ---------------------------------------------------------------------

    function _deposit(bytes32 orderRef, uint64 deliveryDeadline, uint256 amount) internal {
        uint256 authDeadline = block.timestamp + 600;
        uint256 permitDeadline = block.timestamp + 600;
        (uint8 pv, bytes32 pr, bytes32 ps) = _signPermit(buyerPk, buyer, address(escrow), amount, permitDeadline);
        bytes memory authSig = _signDeposit(buyerPk, orderRef, seller, amount, deliveryDeadline, authDeadline);

        escrow.depositWithPermit(
            orderRef, buyer, seller, amount, deliveryDeadline, authDeadline, authSig, permitDeadline, pv, pr, ps
        );
    }

    function _depositDefault(bytes32 orderRef) internal returns (uint64 deliveryDeadline) {
        deliveryDeadline = uint64(block.timestamp + 1800);
        _deposit(orderRef, deliveryDeadline, DEFAULT_AMOUNT);
    }

    // ---------------------------------------------------------------------
    // 1) happy path with claim
    // ---------------------------------------------------------------------

    function test_HappyPath_WithClaim() public {
        bytes32 orderRef = keccak256("order-1");
        uint64 deliveryDeadline = _depositDefault(orderRef);

        uint256 claimSigDeadline = block.timestamp + 600;
        bytes memory sellerSig = _signClaim(sellerPk, orderRef, claimSigDeadline);
        escrow.claimDelivery(orderRef, claimSigDeadline, sellerSig);

        KuskaEscrow.Deal memory deal = escrow.getDeal(orderRef);
        assertEq(uint8(deal.state), uint8(KuskaEscrow.State.DeliveryClaimed));
        assertEq(deal.claimedAt, block.timestamp);

        uint256 releaseSigDeadline = block.timestamp + 600;
        bytes memory buyerSig = _signConfirmation(buyerPk, orderRef, releaseSigDeadline);

        uint256 sellerBalBefore = token.balanceOf(seller);
        escrow.release(orderRef, releaseSigDeadline, buyerSig);

        deal = escrow.getDeal(orderRef);
        assertEq(uint8(deal.state), uint8(KuskaEscrow.State.Released));
        assertEq(token.balanceOf(seller), sellerBalBefore + DEFAULT_AMOUNT);
        assertEq(token.balanceOf(address(escrow)), 0);
        deliveryDeadline; // silence unused warning in some solc configs
    }

    // ---------------------------------------------------------------------
    // 2) happy path without claim (release straight from Funded)
    // ---------------------------------------------------------------------

    function test_HappyPath_ReleaseWithoutClaim() public {
        bytes32 orderRef = keccak256("order-2");
        _depositDefault(orderRef);

        uint256 sigDeadline = block.timestamp + 600;
        bytes memory buyerSig = _signConfirmation(buyerPk, orderRef, sigDeadline);

        uint256 sellerBalBefore = token.balanceOf(seller);
        escrow.release(orderRef, sigDeadline, buyerSig);

        KuskaEscrow.Deal memory deal = escrow.getDeal(orderRef);
        assertEq(uint8(deal.state), uint8(KuskaEscrow.State.Released));
        assertEq(token.balanceOf(seller), sellerBalBefore + DEFAULT_AMOUNT);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    // ---------------------------------------------------------------------
    // 3) invalid transitions from each state
    // ---------------------------------------------------------------------

    function test_InvalidState_FromNone() public {
        bytes32 orderRef = keccak256("order-none");
        vm.expectRevert(abi.encodeWithSelector(KuskaEscrow.InvalidState.selector, KuskaEscrow.State.None));
        escrow.claimDelivery(orderRef, block.timestamp + 600, "");

        vm.expectRevert(abi.encodeWithSelector(KuskaEscrow.InvalidState.selector, KuskaEscrow.State.None));
        escrow.release(orderRef, block.timestamp + 600, "");

        vm.expectRevert(abi.encodeWithSelector(KuskaEscrow.InvalidState.selector, KuskaEscrow.State.None));
        escrow.dispute(orderRef, block.timestamp + 600, "");

        vm.expectRevert(abi.encodeWithSelector(KuskaEscrow.InvalidState.selector, KuskaEscrow.State.None));
        escrow.releaseAfterWindow(orderRef);

        vm.expectRevert(abi.encodeWithSelector(KuskaEscrow.InvalidState.selector, KuskaEscrow.State.None));
        escrow.refundExpired(orderRef);

        vm.expectRevert(abi.encodeWithSelector(KuskaEscrow.InvalidState.selector, KuskaEscrow.State.None));
        escrow.cancel(orderRef, block.timestamp + 600, "");

        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(KuskaEscrow.InvalidState.selector, KuskaEscrow.State.None));
        escrow.resolveDispute(orderRef, true);
    }

    function test_InvalidState_FromFunded() public {
        bytes32 orderRef = keccak256("order-funded");
        _depositDefault(orderRef);

        vm.expectRevert(abi.encodeWithSelector(KuskaEscrow.InvalidState.selector, KuskaEscrow.State.Funded));
        escrow.dispute(orderRef, block.timestamp + 600, "");

        vm.expectRevert(abi.encodeWithSelector(KuskaEscrow.InvalidState.selector, KuskaEscrow.State.Funded));
        escrow.releaseAfterWindow(orderRef);

        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(KuskaEscrow.InvalidState.selector, KuskaEscrow.State.Funded));
        escrow.resolveDispute(orderRef, true);
    }

    function test_InvalidState_FromDeliveryClaimed() public {
        bytes32 orderRef = keccak256("order-claimed");
        _depositDefault(orderRef);
        uint256 sigDeadline = block.timestamp + 600;
        escrow.claimDelivery(orderRef, sigDeadline, _signClaim(sellerPk, orderRef, sigDeadline));

        vm.expectRevert(abi.encodeWithSelector(KuskaEscrow.InvalidState.selector, KuskaEscrow.State.DeliveryClaimed));
        escrow.refundExpired(orderRef);

        vm.expectRevert(abi.encodeWithSelector(KuskaEscrow.InvalidState.selector, KuskaEscrow.State.DeliveryClaimed));
        escrow.cancel(orderRef, block.timestamp + 600, "");

        vm.expectRevert(abi.encodeWithSelector(KuskaEscrow.InvalidState.selector, KuskaEscrow.State.DeliveryClaimed));
        escrow.claimDelivery(orderRef, block.timestamp + 600, "");
    }

    function test_InvalidState_FromDisputed() public {
        bytes32 orderRef = keccak256("order-disputed");
        _depositDefault(orderRef);
        uint256 sigDeadline = block.timestamp + 600;
        escrow.claimDelivery(orderRef, sigDeadline, _signClaim(sellerPk, orderRef, sigDeadline));
        escrow.dispute(orderRef, sigDeadline, _signDispute(buyerPk, orderRef, sigDeadline));

        vm.expectRevert(abi.encodeWithSelector(KuskaEscrow.InvalidState.selector, KuskaEscrow.State.Disputed));
        escrow.release(orderRef, block.timestamp + 600, "");
    }

    // ---------------------------------------------------------------------
    // 4) double release / double refund / orderRef reuse
    // ---------------------------------------------------------------------

    function test_DoubleRelease_Reverts() public {
        bytes32 orderRef = keccak256("order-double-release");
        _depositDefault(orderRef);
        uint256 sigDeadline = block.timestamp + 600;
        bytes memory buyerSig = _signConfirmation(buyerPk, orderRef, sigDeadline);
        escrow.release(orderRef, sigDeadline, buyerSig);

        vm.expectRevert(abi.encodeWithSelector(KuskaEscrow.InvalidState.selector, KuskaEscrow.State.Released));
        escrow.release(orderRef, sigDeadline, buyerSig);
    }

    function test_DoubleRefund_Reverts() public {
        bytes32 orderRef = keccak256("order-double-refund");
        uint64 deliveryDeadline = uint64(block.timestamp + 120);
        _deposit(orderRef, deliveryDeadline, DEFAULT_AMOUNT);

        vm.warp(deliveryDeadline + 1);
        escrow.refundExpired(orderRef);

        vm.expectRevert(abi.encodeWithSelector(KuskaEscrow.InvalidState.selector, KuskaEscrow.State.Refunded));
        escrow.refundExpired(orderRef);
    }

    function test_OrderRefReused_Reverts() public {
        bytes32 orderRef = keccak256("order-reused");
        _depositDefault(orderRef);
        uint256 sigDeadline = block.timestamp + 600;
        escrow.release(orderRef, sigDeadline, _signConfirmation(buyerPk, orderRef, sigDeadline));

        uint64 newDeadline = uint64(block.timestamp + 1800);
        uint256 authDeadline = block.timestamp + 600;
        uint256 permitDeadline = block.timestamp + 600;
        (uint8 pv, bytes32 pr, bytes32 ps) =
            _signPermit(buyerPk, buyer, address(escrow), DEFAULT_AMOUNT, permitDeadline);
        bytes memory authSig =
            _signDeposit(buyerPk, orderRef, seller, DEFAULT_AMOUNT, newDeadline, authDeadline);

        vm.expectRevert(abi.encodeWithSelector(KuskaEscrow.InvalidState.selector, KuskaEscrow.State.Released));
        escrow.depositWithPermit(
            orderRef, buyer, seller, DEFAULT_AMOUNT, newDeadline, authDeadline, authSig, permitDeadline, pv, pr, ps
        );
    }

    // ---------------------------------------------------------------------
    // 5) signature edge cases
    // ---------------------------------------------------------------------

    function test_Signature_WrongSigner_Reverts() public {
        bytes32 orderRef = keccak256("order-wrong-signer");
        _depositDefault(orderRef);
        uint256 sigDeadline = block.timestamp + 600;
        // claim requires the seller's signature; sign with stranger instead.
        bytes memory badSig = _signClaim(strangerPk, orderRef, sigDeadline);

        vm.expectRevert(KuskaEscrow.InvalidSignature.selector);
        escrow.claimDelivery(orderRef, sigDeadline, badSig);
    }

    function test_Signature_WrongTypehash_Reverts() public {
        bytes32 orderRef = keccak256("order-wrong-typehash");
        _depositDefault(orderRef);
        uint256 sigDeadline = block.timestamp + 600;
        // Sign a Cancel struct but submit it as a claimDelivery (DeliveryClaim) signature.
        bytes memory wrongTypeSig = _signCancel(sellerPk, orderRef, sigDeadline);

        vm.expectRevert(KuskaEscrow.InvalidSignature.selector);
        escrow.claimDelivery(orderRef, sigDeadline, wrongTypeSig);
    }

    function test_Signature_WrongVerifyingContract_Reverts() public {
        bytes32 orderRef = keccak256("order-wrong-verifier");
        _depositDefault(orderRef);
        uint256 sigDeadline = block.timestamp + 600;

        bytes32 structHash = keccak256(abi.encode(DELIVERY_CLAIM_TYPEHASH, orderRef, sigDeadline));
        // Sign against a different verifyingContract (the token instead of the escrow).
        bytes32 wrongDigest = _hashTypedData(address(token), "KuskaEscrow", structHash);
        bytes memory badSig = _sign(sellerPk, wrongDigest);

        vm.expectRevert(KuskaEscrow.InvalidSignature.selector);
        escrow.claimDelivery(orderRef, sigDeadline, badSig);
    }

    function test_Signature_TamperedAmount_Reverts() public {
        bytes32 orderRef = keccak256("order-tampered-amount");
        uint64 deliveryDeadline = uint64(block.timestamp + 1800);
        uint256 authDeadline = block.timestamp + 600;

        // Sign for `amount`, but submit a different `amount` to the contract call.
        bytes memory authSig =
            _signDeposit(buyerPk, orderRef, seller, DEFAULT_AMOUNT, deliveryDeadline, authDeadline);

        vm.expectRevert(KuskaEscrow.InvalidSignature.selector);
        escrow.depositWithPermit(
            orderRef,
            buyer,
            seller,
            DEFAULT_AMOUNT + 1,
            deliveryDeadline,
            authDeadline,
            authSig,
            0,
            0,
            bytes32(0),
            bytes32(0)
        );
    }

    function test_Signature_TamperedSeller_Reverts() public {
        bytes32 orderRef = keccak256("order-tampered-seller");
        uint64 deliveryDeadline = uint64(block.timestamp + 1800);
        uint256 authDeadline = block.timestamp + 600;
        address otherSeller = vm.addr(0x5E11E13);

        // Sign for `seller`, but submit a different seller.
        bytes memory authSig =
            _signDeposit(buyerPk, orderRef, seller, DEFAULT_AMOUNT, deliveryDeadline, authDeadline);
        vm.expectRevert(KuskaEscrow.InvalidSignature.selector);
        escrow.depositWithPermit(
            orderRef,
            buyer,
            otherSeller,
            DEFAULT_AMOUNT,
            deliveryDeadline,
            authDeadline,
            authSig,
            0,
            0,
            bytes32(0),
            bytes32(0)
        );
    }

    function test_Signature_TamperedDeadline_Reverts() public {
        bytes32 orderRef = keccak256("order-tampered-deadline");
        uint64 deliveryDeadline = uint64(block.timestamp + 1800);
        uint256 authDeadline = block.timestamp + 600;

        // Sign for one deliveryDeadline, submit another.
        bytes memory authSig =
            _signDeposit(buyerPk, orderRef, seller, DEFAULT_AMOUNT, deliveryDeadline, authDeadline);
        vm.expectRevert(KuskaEscrow.InvalidSignature.selector);
        escrow.depositWithPermit(
            orderRef,
            buyer,
            seller,
            DEFAULT_AMOUNT,
            deliveryDeadline + 1,
            authDeadline,
            authSig,
            0,
            0,
            bytes32(0),
            bytes32(0)
        );
    }

    function test_Signature_Expired_Reverts() public {
        bytes32 orderRef = keccak256("order-expired-authsig");
        uint64 deliveryDeadline = uint64(block.timestamp + 1800);
        uint256 authDeadline = block.timestamp + 600;
        uint256 permitDeadline = block.timestamp + 600;

        bytes memory authSig =
            _signDeposit(buyerPk, orderRef, seller, DEFAULT_AMOUNT, deliveryDeadline, authDeadline);
        (uint8 pv, bytes32 pr, bytes32 ps) =
            _signPermit(buyerPk, buyer, address(escrow), DEFAULT_AMOUNT, permitDeadline);

        vm.warp(authDeadline + 1);
        vm.expectRevert(KuskaEscrow.SignatureExpired.selector);
        escrow.depositWithPermit(
            orderRef, buyer, seller, DEFAULT_AMOUNT, deliveryDeadline, authDeadline, authSig, permitDeadline, pv, pr, ps
        );
    }

    // ---------------------------------------------------------------------
    // 6) exact boundaries
    // ---------------------------------------------------------------------

    function test_ClaimBoundary_ExactDeadlinePassesPlusOneReverts() public {
        bytes32 orderRef1 = keccak256("order-claim-boundary-ok");
        uint64 deliveryDeadline1 = _depositDefault(orderRef1);
        vm.warp(deliveryDeadline1);
        uint256 sigDeadline = block.timestamp + 600;
        escrow.claimDelivery(orderRef1, sigDeadline, _signClaim(sellerPk, orderRef1, sigDeadline));
        assertEq(uint8(escrow.getDeal(orderRef1).state), uint8(KuskaEscrow.State.DeliveryClaimed));

        bytes32 orderRef2 = keccak256("order-claim-boundary-fail");
        uint64 deliveryDeadline2 = _depositDefault(orderRef2);
        vm.warp(deliveryDeadline2 + 1);
        uint256 sigDeadline2 = block.timestamp + 600;
        vm.expectRevert(KuskaEscrow.DeliveryDeadlinePassed.selector);
        escrow.claimDelivery(orderRef2, sigDeadline2, _signClaim(sellerPk, orderRef2, sigDeadline2));
    }

    function test_RefundExpiredBoundary_ExactDeadlineRevertsPlusOnePasses() public {
        bytes32 orderRef = keccak256("order-refund-boundary");
        uint64 deliveryDeadline = uint64(block.timestamp + 120);
        _deposit(orderRef, deliveryDeadline, DEFAULT_AMOUNT);

        vm.warp(deliveryDeadline);
        vm.expectRevert(KuskaEscrow.DeliveryDeadlineNotReached.selector);
        escrow.refundExpired(orderRef);

        vm.warp(deliveryDeadline + 1);
        escrow.refundExpired(orderRef);
        assertEq(uint8(escrow.getDeal(orderRef).state), uint8(KuskaEscrow.State.Refunded));
    }

    function test_DisputeBoundary_WindowMinusOnePassesWindowReverts() public {
        bytes32 orderRef = keccak256("order-dispute-boundary");
        _depositDefault(orderRef);
        uint256 claimSigDeadline = block.timestamp + 600;
        escrow.claimDelivery(orderRef, claimSigDeadline, _signClaim(sellerPk, orderRef, claimSigDeadline));
        uint64 claimedAt = escrow.getDeal(orderRef).claimedAt;

        vm.warp(claimedAt + DISPUTE_WINDOW - 1);
        uint256 sigDeadline = block.timestamp + 600;
        escrow.dispute(orderRef, sigDeadline, _signDispute(buyerPk, orderRef, sigDeadline));
        assertEq(uint8(escrow.getDeal(orderRef).state), uint8(KuskaEscrow.State.Disputed));

        bytes32 orderRef2 = keccak256("order-dispute-boundary-fail");
        _depositDefault(orderRef2);
        uint256 claimSigDeadline2 = block.timestamp + 600;
        escrow.claimDelivery(orderRef2, claimSigDeadline2, _signClaim(sellerPk, orderRef2, claimSigDeadline2));
        uint64 claimedAt2 = escrow.getDeal(orderRef2).claimedAt;

        vm.warp(claimedAt2 + DISPUTE_WINDOW);
        uint256 sigDeadline2 = block.timestamp + 600;
        vm.expectRevert(KuskaEscrow.DisputeWindowClosed.selector);
        escrow.dispute(orderRef2, sigDeadline2, _signDispute(buyerPk, orderRef2, sigDeadline2));
    }

    function test_ReleaseAfterWindowBoundary_ExactWindowPasses() public {
        bytes32 orderRef = keccak256("order-release-after-window");
        _depositDefault(orderRef);
        uint256 claimSigDeadline = block.timestamp + 600;
        escrow.claimDelivery(orderRef, claimSigDeadline, _signClaim(sellerPk, orderRef, claimSigDeadline));
        uint64 claimedAt = escrow.getDeal(orderRef).claimedAt;

        vm.warp(claimedAt + DISPUTE_WINDOW - 1);
        vm.expectRevert(KuskaEscrow.DisputeWindowOpen.selector);
        escrow.releaseAfterWindow(orderRef);

        vm.warp(claimedAt + DISPUTE_WINDOW);
        escrow.releaseAfterWindow(orderRef);
        assertEq(uint8(escrow.getDeal(orderRef).state), uint8(KuskaEscrow.State.Released));
    }

    // ---------------------------------------------------------------------
    // 7) races
    // ---------------------------------------------------------------------

    function test_Race_ClaimVsRefund() public {
        bytes32 orderRef = keccak256("order-race-claim-refund");
        uint64 deliveryDeadline = uint64(block.timestamp + 120);
        _deposit(orderRef, deliveryDeadline, DEFAULT_AMOUNT);

        uint256 sigDeadline = block.timestamp + 600;
        escrow.claimDelivery(orderRef, sigDeadline, _signClaim(sellerPk, orderRef, sigDeadline));

        vm.warp(deliveryDeadline + 1);
        vm.expectRevert(abi.encodeWithSelector(KuskaEscrow.InvalidState.selector, KuskaEscrow.State.DeliveryClaimed));
        escrow.refundExpired(orderRef);
    }

    function test_Race_DisputeVsReleaseAfterWindow() public {
        bytes32 orderRef = keccak256("order-race-dispute-release");
        _depositDefault(orderRef);
        uint256 claimSigDeadline = block.timestamp + 600;
        escrow.claimDelivery(orderRef, claimSigDeadline, _signClaim(sellerPk, orderRef, claimSigDeadline));
        uint64 claimedAt = escrow.getDeal(orderRef).claimedAt;

        vm.warp(claimedAt + DISPUTE_WINDOW - 1);
        uint256 sigDeadline = block.timestamp + 600;
        escrow.dispute(orderRef, sigDeadline, _signDispute(buyerPk, orderRef, sigDeadline));

        vm.warp(claimedAt + DISPUTE_WINDOW);
        vm.expectRevert(abi.encodeWithSelector(KuskaEscrow.InvalidState.selector, KuskaEscrow.State.Disputed));
        escrow.releaseAfterWindow(orderRef);
    }

    function test_Race_CancelVsClaim() public {
        bytes32 orderRef = keccak256("order-race-cancel-claim");
        _depositDefault(orderRef);

        uint256 sigDeadline = block.timestamp + 600;
        escrow.cancel(orderRef, sigDeadline, _signCancel(sellerPk, orderRef, sigDeadline));

        vm.expectRevert(abi.encodeWithSelector(KuskaEscrow.InvalidState.selector, KuskaEscrow.State.Refunded));
        escrow.claimDelivery(orderRef, sigDeadline, _signClaim(sellerPk, orderRef, sigDeadline));
    }

    // ---------------------------------------------------------------------
    // 8) Disputed blocks releaseAfterWindow and refundExpired
    // ---------------------------------------------------------------------

    function test_Disputed_BlocksReleaseAfterWindowAndRefundExpired() public {
        bytes32 orderRef = keccak256("order-disputed-blocks");
        _depositDefault(orderRef);
        uint256 sigDeadline = block.timestamp + 600;
        escrow.claimDelivery(orderRef, sigDeadline, _signClaim(sellerPk, orderRef, sigDeadline));
        escrow.dispute(orderRef, sigDeadline, _signDispute(buyerPk, orderRef, sigDeadline));

        vm.expectRevert(abi.encodeWithSelector(KuskaEscrow.InvalidState.selector, KuskaEscrow.State.Disputed));
        escrow.releaseAfterWindow(orderRef);

        vm.expectRevert(abi.encodeWithSelector(KuskaEscrow.InvalidState.selector, KuskaEscrow.State.Disputed));
        escrow.refundExpired(orderRef);
    }

    // ---------------------------------------------------------------------
    // 9) permit frontrun + invalid authSig with valid permit
    // ---------------------------------------------------------------------

    function test_Permit_FrontrunStillDeposits() public {
        bytes32 orderRef = keccak256("order-permit-frontrun");
        uint64 deliveryDeadline = uint64(block.timestamp + 1800);
        uint256 authDeadline = block.timestamp + 600;
        uint256 permitDeadline = block.timestamp + 600;

        (uint8 pv, bytes32 pr, bytes32 ps) =
            _signPermit(buyerPk, buyer, address(escrow), DEFAULT_AMOUNT, permitDeadline);

        // Someone frontruns and consumes the permit signature directly on the token.
        token.permit(buyer, address(escrow), DEFAULT_AMOUNT, permitDeadline, pv, pr, ps);
        assertEq(token.allowance(buyer, address(escrow)), DEFAULT_AMOUNT);

        bytes memory authSig =
            _signDeposit(buyerPk, orderRef, seller, DEFAULT_AMOUNT, deliveryDeadline, authDeadline);

        // The escrow's own permit() call will revert internally (nonce already used) but is
        // swallowed by try/catch; the deposit still succeeds because allowance is already set.
        escrow.depositWithPermit(
            orderRef, buyer, seller, DEFAULT_AMOUNT, deliveryDeadline, authDeadline, authSig, permitDeadline, pv, pr, ps
        );

        assertEq(uint8(escrow.getDeal(orderRef).state), uint8(KuskaEscrow.State.Funded));
        assertEq(token.balanceOf(address(escrow)), DEFAULT_AMOUNT);
    }

    function test_Permit_InvalidAuthSigWithValidPermit_Reverts() public {
        bytes32 orderRef = keccak256("order-permit-invalid-authsig");
        uint64 deliveryDeadline = uint64(block.timestamp + 1800);
        uint256 authDeadline = block.timestamp + 600;
        uint256 permitDeadline = block.timestamp + 600;

        (uint8 pv, bytes32 pr, bytes32 ps) =
            _signPermit(buyerPk, buyer, address(escrow), DEFAULT_AMOUNT, permitDeadline);
        // authSig signed by stranger instead of buyer -> invalid.
        bytes memory authSig =
            _signDeposit(strangerPk, orderRef, seller, DEFAULT_AMOUNT, deliveryDeadline, authDeadline);

        vm.expectRevert(KuskaEscrow.InvalidSignature.selector);
        escrow.depositWithPermit(
            orderRef, buyer, seller, DEFAULT_AMOUNT, deliveryDeadline, authDeadline, authSig, permitDeadline, pv, pr, ps
        );
    }

    // ---------------------------------------------------------------------
    // 10) amount / address / deadline validation
    // ---------------------------------------------------------------------

    function test_InvalidAmount_ZeroAndTooLarge() public {
        bytes32 orderRef1 = keccak256("order-amount-zero");
        uint64 deliveryDeadline = uint64(block.timestamp + 1800);
        uint256 authDeadline = block.timestamp + 600;
        uint256 permitDeadline = block.timestamp + 600;

        vm.expectRevert(KuskaEscrow.InvalidAmount.selector);
        escrow.depositWithPermit(
            orderRef1, buyer, seller, 0, deliveryDeadline, authDeadline, "", permitDeadline, 0, bytes32(0), bytes32(0)
        );

        bytes32 orderRef2 = keccak256("order-amount-too-large");
        uint256 tooLarge = uint256(type(uint96).max) + 1;
        vm.expectRevert(KuskaEscrow.InvalidAmount.selector);
        escrow.depositWithPermit(
            orderRef2,
            buyer,
            seller,
            tooLarge,
            deliveryDeadline,
            authDeadline,
            "",
            permitDeadline,
            0,
            bytes32(0),
            bytes32(0)
        );
    }

    function test_InvalidAddress_SellerEqualsBuyerAndZero() public {
        bytes32 orderRef1 = keccak256("order-addr-equal");
        uint64 deliveryDeadline = uint64(block.timestamp + 1800);
        uint256 authDeadline = block.timestamp + 600;
        uint256 permitDeadline = block.timestamp + 600;

        vm.expectRevert(KuskaEscrow.InvalidAddress.selector);
        escrow.depositWithPermit(
            orderRef1,
            buyer,
            buyer,
            DEFAULT_AMOUNT,
            deliveryDeadline,
            authDeadline,
            "",
            permitDeadline,
            0,
            bytes32(0),
            bytes32(0)
        );

        bytes32 orderRef2 = keccak256("order-addr-zero-seller");
        vm.expectRevert(KuskaEscrow.InvalidAddress.selector);
        escrow.depositWithPermit(
            orderRef2,
            buyer,
            address(0),
            DEFAULT_AMOUNT,
            deliveryDeadline,
            authDeadline,
            "",
            permitDeadline,
            0,
            bytes32(0),
            bytes32(0)
        );

        bytes32 orderRef3 = keccak256("order-addr-zero-buyer");
        vm.expectRevert(KuskaEscrow.InvalidAddress.selector);
        escrow.depositWithPermit(
            orderRef3,
            address(0),
            seller,
            DEFAULT_AMOUNT,
            deliveryDeadline,
            authDeadline,
            "",
            permitDeadline,
            0,
            bytes32(0),
            bytes32(0)
        );
    }

    function test_DeliveryDeadlinePassed_AtDeposit() public {
        bytes32 orderRef = keccak256("order-deadline-passed");
        uint64 deliveryDeadline = uint64(block.timestamp);
        uint256 authDeadline = block.timestamp + 600;
        uint256 permitDeadline = block.timestamp + 600;

        vm.expectRevert(KuskaEscrow.DeliveryDeadlinePassed.selector);
        escrow.depositWithPermit(
            orderRef,
            buyer,
            seller,
            DEFAULT_AMOUNT,
            deliveryDeadline,
            authDeadline,
            "",
            permitDeadline,
            0,
            bytes32(0),
            bytes32(0)
        );
    }

    // ---------------------------------------------------------------------
    // 11) resolveDispute
    // ---------------------------------------------------------------------

    function test_ResolveDispute_ToSeller() public {
        bytes32 orderRef = keccak256("order-resolve-seller");
        _depositDefault(orderRef);
        uint256 sigDeadline = block.timestamp + 600;
        escrow.claimDelivery(orderRef, sigDeadline, _signClaim(sellerPk, orderRef, sigDeadline));
        escrow.dispute(orderRef, sigDeadline, _signDispute(buyerPk, orderRef, sigDeadline));

        uint256 sellerBalBefore = token.balanceOf(seller);
        vm.prank(arbiter);
        escrow.resolveDispute(orderRef, true);

        assertEq(uint8(escrow.getDeal(orderRef).state), uint8(KuskaEscrow.State.Released));
        assertEq(token.balanceOf(seller), sellerBalBefore + DEFAULT_AMOUNT);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function test_ResolveDispute_ToBuyer() public {
        bytes32 orderRef = keccak256("order-resolve-buyer");
        _depositDefault(orderRef);
        uint256 sigDeadline = block.timestamp + 600;
        escrow.claimDelivery(orderRef, sigDeadline, _signClaim(sellerPk, orderRef, sigDeadline));
        escrow.dispute(orderRef, sigDeadline, _signDispute(buyerPk, orderRef, sigDeadline));

        uint256 buyerBalBefore = token.balanceOf(buyer);
        vm.prank(arbiter);
        escrow.resolveDispute(orderRef, false);

        assertEq(uint8(escrow.getDeal(orderRef).state), uint8(KuskaEscrow.State.Refunded));
        assertEq(token.balanceOf(buyer), buyerBalBefore + DEFAULT_AMOUNT);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function test_ResolveDispute_NotArbiter_Reverts() public {
        bytes32 orderRef = keccak256("order-resolve-not-arbiter");
        _depositDefault(orderRef);
        uint256 sigDeadline = block.timestamp + 600;
        escrow.claimDelivery(orderRef, sigDeadline, _signClaim(sellerPk, orderRef, sigDeadline));
        escrow.dispute(orderRef, sigDeadline, _signDispute(buyerPk, orderRef, sigDeadline));

        vm.prank(stranger);
        vm.expectRevert(KuskaEscrow.NotArbiter.selector);
        escrow.resolveDispute(orderRef, true);
    }

    // ---------------------------------------------------------------------
    // 12) faucet cooldown
    // ---------------------------------------------------------------------

    function test_Faucet_CooldownAndReset() public {
        address recipient = vm.addr(0x1234);
        token.faucet(recipient);
        assertEq(token.balanceOf(recipient), 100e6);

        vm.expectRevert(abi.encodeWithSelector(MockUSD.FaucetCooldown.selector, block.timestamp + 1 hours));
        token.faucet(recipient);

        vm.warp(block.timestamp + 1 hours);
        token.faucet(recipient);
        assertEq(token.balanceOf(recipient), 200e6);
    }

    // ---------------------------------------------------------------------
    // 13) event argument checks
    // ---------------------------------------------------------------------

    function test_Events_DepositReleaseRefund() public {
        bytes32 orderRef = keccak256("order-events-deposit");
        uint64 deliveryDeadline = uint64(block.timestamp + 1800);
        uint256 authDeadline = block.timestamp + 600;
        uint256 permitDeadline = block.timestamp + 600;
        (uint8 pv, bytes32 pr, bytes32 ps) =
            _signPermit(buyerPk, buyer, address(escrow), DEFAULT_AMOUNT, permitDeadline);
        bytes memory authSig =
            _signDeposit(buyerPk, orderRef, seller, DEFAULT_AMOUNT, deliveryDeadline, authDeadline);

        vm.expectEmit(true, true, true, true, address(escrow));
        emit KuskaEscrow.Deposited(orderRef, buyer, seller, DEFAULT_AMOUNT, deliveryDeadline);
        escrow.depositWithPermit(
            orderRef, buyer, seller, DEFAULT_AMOUNT, deliveryDeadline, authDeadline, authSig, permitDeadline, pv, pr, ps
        );

        uint256 sigDeadline = block.timestamp + 600;
        vm.expectEmit(true, true, false, true, address(escrow));
        emit KuskaEscrow.Released(orderRef, seller, DEFAULT_AMOUNT, 0);
        escrow.release(orderRef, sigDeadline, _signConfirmation(buyerPk, orderRef, sigDeadline));

        bytes32 orderRef2 = keccak256("order-events-refund");
        uint64 shortDeadline = uint64(block.timestamp + 120);
        _deposit(orderRef2, shortDeadline, DEFAULT_AMOUNT);
        vm.warp(shortDeadline + 1);

        vm.expectEmit(true, true, false, true, address(escrow));
        emit KuskaEscrow.Refunded(orderRef2, buyer, DEFAULT_AMOUNT, 0);
        escrow.refundExpired(orderRef2);
    }

    // ---------------------------------------------------------------------
    // 14) ERC-1271 contract wallet signature
    // ---------------------------------------------------------------------

    function test_ERC1271_SignatureAccepted() public {
        // buyer is a contract wallet owned by buyerPk's EOA.
        ERC1271WalletMock walletBuyer = new ERC1271WalletMock(buyer);
        address contractBuyer = address(walletBuyer);

        vm.prank(contractBuyer);
        token.faucet(contractBuyer);

        bytes32 orderRef = keccak256("order-erc1271");
        uint64 deliveryDeadline = uint64(block.timestamp + 1800);
        uint256 authDeadline = block.timestamp + 600;
        uint256 permitDeadline = block.timestamp + 600;

        // MockUSD's permit() uses ECDSA.recover directly (per ERC-2612), so it cannot validate
        // an ERC-1271 contract signature. The contract-wallet buyer approves normally instead,
        // and the escrow's permit() call reverts internally but is swallowed by try/catch.
        vm.prank(contractBuyer);
        token.approve(address(escrow), DEFAULT_AMOUNT);

        bytes memory authSig =
            _signDeposit(buyerPk, orderRef, seller, DEFAULT_AMOUNT, deliveryDeadline, authDeadline);

        escrow.depositWithPermit(
            orderRef,
            contractBuyer,
            seller,
            DEFAULT_AMOUNT,
            deliveryDeadline,
            authDeadline,
            authSig,
            permitDeadline,
            0,
            bytes32(0),
            bytes32(0)
        );

        assertEq(uint8(escrow.getDeal(orderRef).state), uint8(KuskaEscrow.State.Funded));

        // release() is signed by the underlying EOA and validated via SignatureChecker against
        // the ERC-1271 contract wallet buyer.
        uint256 sigDeadline = block.timestamp + 600;
        bytes memory buyerSig = _signConfirmation(buyerPk, orderRef, sigDeadline);

        uint256 sellerBalBefore = token.balanceOf(seller);
        escrow.release(orderRef, sigDeadline, buyerSig);

        assertEq(uint8(escrow.getDeal(orderRef).state), uint8(KuskaEscrow.State.Released));
        assertEq(token.balanceOf(seller), sellerBalBefore + DEFAULT_AMOUNT);
    }
}
