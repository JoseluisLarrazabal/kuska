import type { Address, Hex, PrivateKeyAccount } from "viem";
import { getPublicClient } from "./viemClient";
import { getDeploymentConfig } from "../../config/deployment";
import { newOrderRef } from "../escrow/orderRef";
import { buildDepositAuthorization, buildPermit, resolveTokenDomain } from "../escrow/typedData";
import { getTokenNonce } from "./token";
import { postRelay, type RelayOutcome } from "./relayer";

/** `authDeadline`/`permitDeadline` (docs/escrow-interface.md §4: now + 600s). */
const SIG_WINDOW_SECONDS = 600;

export interface CreateOrderParams {
  /** Cuenta burner del comprador (ya creada: `getOrCreateAccount()`). */
  buyer: PrivateKeyAccount;
  seller: Address;
  /** Monto en unidades mínimas (6 decimales). */
  amount: bigint;
  /** Segundos desde ahora hasta `deliveryDeadline` (1800 flujo normal, 120 demo de reembolso). */
  deliverySeconds: number;
}

export interface CreateOrderResult {
  orderRef: Hex;
  outcome: RelayOutcome;
}

/**
 * Flujo completo del comprador para fondear un pedido: firma la autorización
 * de depósito (EIP-712 del escrow) + el permit EIP-2612 del token, y llama al
 * relayer. No requiere gas del comprador.
 */
export async function createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
  const { buyer, seller, amount, deliverySeconds } = params;
  const client = getPublicClient();
  const { chainId, escrowAddress, tokenAddress } = getDeploymentConfig();

  const orderRef = newOrderRef();
  const now = Math.floor(Date.now() / 1000);
  const deliveryDeadline = BigInt(now + deliverySeconds);
  const authDeadline = BigInt(now + SIG_WINDOW_SECONDS);
  const permitDeadline = BigInt(now + SIG_WINDOW_SECONDS);

  const depositAuth = buildDepositAuthorization({
    chainId,
    verifyingContract: escrowAddress,
    orderRef,
    seller,
    amount,
    deliveryDeadline,
    authDeadline,
  });
  const authSig = await buyer.signTypedData(depositAuth);

  const tokenDomain = await resolveTokenDomain(client, tokenAddress, chainId);
  const nonce = await getTokenNonce(client, tokenAddress, buyer.address);
  const permit = buildPermit({
    domain: tokenDomain,
    owner: buyer.address,
    spender: escrowAddress,
    value: amount,
    nonce,
    deadline: permitDeadline,
  });
  const permitSig = await buyer.signTypedData(permit);

  const outcome = await postRelay({
    action: "deposit",
    params: {
      orderRef,
      buyer: buyer.address,
      seller,
      amount: amount.toString(),
      deliveryDeadline: deliveryDeadline.toString(),
      authDeadline: authDeadline.toString(),
      authSig,
      permitDeadline: permitDeadline.toString(),
      permitSig,
    },
  });

  return { orderRef, outcome };
}
