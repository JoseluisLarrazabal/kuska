import type { Address, PublicClient } from "viem";

// ---------------------------------------------------------------------------
// Guarda contra direcciones mal configuradas: el relayer ya mandó una tx de
// faucet a una dirección sin contrato en testnet (typo en una env var). Antes
// de mandar CUALQUIER transacción, los handlers verifican con `getCode` que
// la dirección destino tiene bytecode desplegado. El resultado se cachea en
// memoria por proceso (una dirección de escrow/token no cambia en caliente),
// para no pagar un round-trip de RPC extra en cada request.
// ---------------------------------------------------------------------------

const contractCache = new Map<string, boolean>();

/** ¿`address` tiene bytecode desplegado? (cacheado en memoria por proceso). */
export async function isContractAddress(
  publicClient: PublicClient,
  address: Address,
): Promise<boolean> {
  const cached = contractCache.get(address);
  if (cached !== undefined) return cached;

  const code = await publicClient.getCode({ address });
  const isContract = !!code && code !== "0x";
  contractCache.set(address, isContract);
  return isContract;
}

/** Solo para tests: limpia la caché de direcciones verificadas. */
export function resetContractGuardCache(): void {
  contractCache.clear();
}
