import type { Address, PublicClient } from "viem";

// ---------------------------------------------------------------------------
// Guarda contra direcciones mal configuradas: el relayer ya mandó una tx de
// faucet a una dirección sin contrato en testnet (typo en una env var). Antes
// de mandar CUALQUIER transacción, los handlers verifican con `getCode` que
// la dirección destino tiene bytecode desplegado. El resultado se cachea en
// memoria por proceso, pero de forma ASIMÉTRICA: solo se cachea `true`. Un
// `true` es estable para toda la vida del proceso (una dirección de escrow/
// token desplegada no deja de ser un contrato), así que evitamos un
// round-trip de RPC en cada request. Un `false`, en cambio, NO se cachea:
// si el relayer arranca antes de que el contrato esté desplegado (o con la
// dirección configurada apuntando todavía a bytecode vacío), cachear el
// `false` dejaría la dirección marcada como "no es contrato" para siempre,
// aun después del deploy real — forzando un reinicio manual del proceso para
// que el guard vuelva a levantar el 200. `false` es el camino de error
// (503 MISCONFIGURED): un round-trip de RPC extra ahí no importa.
// ---------------------------------------------------------------------------

const contractCache = new Map<string, boolean>();

/** ¿`address` tiene bytecode desplegado? (los `true` se cachean por proceso; los `false`, no). */
export async function isContractAddress(
  publicClient: PublicClient,
  address: Address,
): Promise<boolean> {
  const cached = contractCache.get(address);
  if (cached === true) return true;

  const code = await publicClient.getCode({ address });
  const isContract = !!code && code !== "0x";
  if (isContract) contractCache.set(address, true);
  return isContract;
}

/** Solo para tests: limpia la caché de direcciones verificadas. */
export function resetContractGuardCache(): void {
  contractCache.clear();
}
