import type { Address, PublicClient } from "viem";
import { mockUsdAbi } from "../escrow/abi";

/**
 * Lecturas directas de `MockUSD` que no son "estado del deal" (por eso no
 * viven en `lib/escrow/read.ts`, que solo expone `getDeal`): el nonce EIP-2612
 * necesario para firmar el permit del comprador, y el balance del token para
 * el panel de demo. Sigue el mismo patrón de lectura directa que ya usa
 * `resolveTokenDomain` en `lib/escrow/typedData.ts`. Desvío documentado en el
 * reporte final.
 */
export async function getTokenNonce(
  client: PublicClient,
  tokenAddress: Address,
  owner: Address,
): Promise<bigint> {
  return client.readContract({
    address: tokenAddress,
    abi: mockUsdAbi,
    functionName: "nonces",
    args: [owner],
  });
}

export async function getTokenBalance(
  client: PublicClient,
  tokenAddress: Address,
  owner: Address,
): Promise<bigint> {
  return client.readContract({
    address: tokenAddress,
    abi: mockUsdAbi,
    functionName: "balanceOf",
    args: [owner],
  });
}
