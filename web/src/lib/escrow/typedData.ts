import type { Address, Hex, PublicClient } from "viem";
import { mockUsdAbi } from "./abi.js";

/** Dominio EIP-712 de `KuskaEscrow` (constructor: name "KuskaEscrow", version "1"). */
export function escrowDomain(chainId: number, verifyingContract: Address) {
  return {
    name: "KuskaEscrow",
    version: "1",
    chainId,
    verifyingContract,
  } as const;
}

// --- Tipos EIP-712 exactos (docs/escrow-interface.md sección 3) ---

export const depositAuthorizationTypes = {
  DepositAuthorization: [
    { name: "orderRef", type: "bytes32" },
    { name: "seller", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "deliveryDeadline", type: "uint64" },
    { name: "authDeadline", type: "uint256" },
  ],
} as const;

export const deliveryClaimTypes = {
  DeliveryClaim: [
    { name: "orderRef", type: "bytes32" },
    { name: "sigDeadline", type: "uint256" },
  ],
} as const;

export const cancelTypes = {
  Cancel: [
    { name: "orderRef", type: "bytes32" },
    { name: "sigDeadline", type: "uint256" },
  ],
} as const;

export const deliveryConfirmationTypes = {
  DeliveryConfirmation: [
    { name: "orderRef", type: "bytes32" },
    { name: "sigDeadline", type: "uint256" },
  ],
} as const;

export const disputeTypes = {
  Dispute: [
    { name: "orderRef", type: "bytes32" },
    { name: "sigDeadline", type: "uint256" },
  ],
} as const;

/** Firma: buyer. Usado por `depositWithPermit` (campo `authSig`). */
export function buildDepositAuthorization(params: {
  chainId: number;
  verifyingContract: Address;
  orderRef: Hex;
  seller: Address;
  amount: bigint;
  deliveryDeadline: bigint;
  authDeadline: bigint;
}) {
  return {
    domain: escrowDomain(params.chainId, params.verifyingContract),
    types: depositAuthorizationTypes,
    primaryType: "DepositAuthorization" as const,
    message: {
      orderRef: params.orderRef,
      seller: params.seller,
      amount: params.amount,
      deliveryDeadline: params.deliveryDeadline,
      authDeadline: params.authDeadline,
    },
  } as const;
}

/** Firma: seller. Usado por `claimDelivery` (campo `sellerSig`). */
export function buildDeliveryClaim(params: {
  chainId: number;
  verifyingContract: Address;
  orderRef: Hex;
  sigDeadline: bigint;
}) {
  return {
    domain: escrowDomain(params.chainId, params.verifyingContract),
    types: deliveryClaimTypes,
    primaryType: "DeliveryClaim" as const,
    message: { orderRef: params.orderRef, sigDeadline: params.sigDeadline },
  } as const;
}

/** Firma: seller. Usado por `cancel` (campo `sellerSig`). */
export function buildCancel(params: {
  chainId: number;
  verifyingContract: Address;
  orderRef: Hex;
  sigDeadline: bigint;
}) {
  return {
    domain: escrowDomain(params.chainId, params.verifyingContract),
    types: cancelTypes,
    primaryType: "Cancel" as const,
    message: { orderRef: params.orderRef, sigDeadline: params.sigDeadline },
  } as const;
}

/** Firma: buyer. Usado por `release` (campo `buyerSig`). */
export function buildDeliveryConfirmation(params: {
  chainId: number;
  verifyingContract: Address;
  orderRef: Hex;
  sigDeadline: bigint;
}) {
  return {
    domain: escrowDomain(params.chainId, params.verifyingContract),
    types: deliveryConfirmationTypes,
    primaryType: "DeliveryConfirmation" as const,
    message: { orderRef: params.orderRef, sigDeadline: params.sigDeadline },
  } as const;
}

/** Firma: buyer. Usado por `dispute` (campo `buyerSig`). */
export function buildDispute(params: {
  chainId: number;
  verifyingContract: Address;
  orderRef: Hex;
  sigDeadline: bigint;
}) {
  return {
    domain: escrowDomain(params.chainId, params.verifyingContract),
    types: disputeTypes,
    primaryType: "Dispute" as const,
    message: { orderRef: params.orderRef, sigDeadline: params.sigDeadline },
  } as const;
}

// --- EIP-2612 Permit (dominio del TOKEN, no del escrow) ---

export interface TokenEip712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
}

/**
 * Resuelve el dominio EIP-712 del token: intenta `eip712Domain()` (EIP-5267,
 * lo trae OZ en MockUSD); si revierte (p. ej. USDC.e/FiatTokenV2_2), cae a
 * `name()` + `version()` (fallback "1" si `version()` tampoco existe).
 */
export async function resolveTokenDomain(
  client: PublicClient,
  tokenAddress: Address,
  chainId: number,
): Promise<TokenEip712Domain> {
  try {
    const result = await client.readContract({
      address: tokenAddress,
      abi: mockUsdAbi,
      functionName: "eip712Domain",
    });
    const [, name, version, domainChainId, verifyingContract] = result;
    return {
      name,
      version,
      chainId: Number(domainChainId),
      verifyingContract,
    };
  } catch {
    const name = await client.readContract({
      address: tokenAddress,
      abi: mockUsdAbi,
      functionName: "name",
    });

    let version = "1";
    try {
      version = await client.readContract({
        address: tokenAddress,
        abi: mockUsdAbi,
        functionName: "version",
      });
    } catch {
      // el token no expone version(): default "1"
    }

    return { name, version, chainId, verifyingContract: tokenAddress };
  }
}

export const permitTypes = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** Firma: buyer (owner). EIP-2612 permit sobre el token hacia el escrow (spender). */
export function buildPermit(params: {
  domain: TokenEip712Domain;
  owner: Address;
  spender: Address;
  value: bigint;
  nonce: bigint;
  deadline: bigint;
}) {
  return {
    domain: params.domain,
    types: permitTypes,
    primaryType: "Permit" as const,
    message: {
      owner: params.owner,
      spender: params.spender,
      value: params.value,
      nonce: params.nonce,
      deadline: params.deadline,
    },
  } as const;
}
