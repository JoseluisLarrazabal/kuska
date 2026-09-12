import type { Hex, PrivateKeyAccount } from "viem";
import { getDeploymentConfig } from "../../config/deployment";
import {
  buildCancel,
  buildDeliveryClaim,
  buildDeliveryConfirmation,
  buildDispute,
} from "../escrow/typedData";
import { postRelay, type RelayOutcome } from "./relayer";

/** `sigDeadline` (docs/escrow-interface.md §4: now + 600s). */
const SIG_WINDOW_SECONDS = 600;

function sigDeadline(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + SIG_WINDOW_SECONDS);
}

/** Vendedor registra la entrega (firma `DeliveryClaim`). */
export async function claimDelivery(seller: PrivateKeyAccount, orderRef: Hex): Promise<RelayOutcome> {
  const { chainId, escrowAddress } = getDeploymentConfig();
  const deadline = sigDeadline();
  const typedData = buildDeliveryClaim({
    chainId,
    verifyingContract: escrowAddress,
    orderRef,
    sigDeadline: deadline,
  });
  const sellerSig = await seller.signTypedData(typedData);
  return postRelay({
    action: "claim",
    params: { orderRef, sigDeadline: deadline.toString(), sellerSig },
  });
}

/** Vendedor cancela un pedido todavía no entregado (firma `Cancel`). */
export async function cancelOrder(seller: PrivateKeyAccount, orderRef: Hex): Promise<RelayOutcome> {
  const { chainId, escrowAddress } = getDeploymentConfig();
  const deadline = sigDeadline();
  const typedData = buildCancel({
    chainId,
    verifyingContract: escrowAddress,
    orderRef,
    sigDeadline: deadline,
  });
  const sellerSig = await seller.signTypedData(typedData);
  return postRelay({
    action: "cancel",
    params: { orderRef, sigDeadline: deadline.toString(), sellerSig },
  });
}

/** Comprador confirma recepción y libera el pago (firma `DeliveryConfirmation`). */
export async function confirmRelease(buyer: PrivateKeyAccount, orderRef: Hex): Promise<RelayOutcome> {
  const { chainId, escrowAddress } = getDeploymentConfig();
  const deadline = sigDeadline();
  const typedData = buildDeliveryConfirmation({
    chainId,
    verifyingContract: escrowAddress,
    orderRef,
    sigDeadline: deadline,
  });
  const buyerSig = await buyer.signTypedData(typedData);
  return postRelay({
    action: "release",
    params: { orderRef, sigDeadline: deadline.toString(), buyerSig },
  });
}

/** Comprador abre una disputa dentro de la ventana (firma `Dispute`). */
export async function openDispute(buyer: PrivateKeyAccount, orderRef: Hex): Promise<RelayOutcome> {
  const { chainId, escrowAddress } = getDeploymentConfig();
  const deadline = sigDeadline();
  const typedData = buildDispute({
    chainId,
    verifyingContract: escrowAddress,
    orderRef,
    sigDeadline: deadline,
  });
  const buyerSig = await buyer.signTypedData(typedData);
  return postRelay({
    action: "dispute",
    params: { orderRef, sigDeadline: deadline.toString(), buyerSig },
  });
}

/** Reembolso si nunca hubo intento de entrega (no requiere firma). */
export async function refundExpired(orderRef: Hex): Promise<RelayOutcome> {
  return postRelay({ action: "refundExpired", params: { orderRef } });
}

/** Liberación automática pasada la ventana de disputa (no requiere firma). */
export async function releaseAfterWindow(orderRef: Hex): Promise<RelayOutcome> {
  return postRelay({ action: "releaseAfterWindow", params: { orderRef } });
}
