import { useQuery } from "@tanstack/react-query";
import type { Address, Hex } from "viem";
import { getPublicClient } from "./viemClient";
import { getDeploymentConfig } from "../../config/deployment";
import { kuskaEscrowAbi } from "../escrow/abi";

/**
 * Tamaño máximo de rango de bloques por llamada a `getContractEvents`. Un
 * RPC puede limitar cuántos bloques acepta de una — nunca se manda
 * `[deployBlock, latest]` entero si esa ventana supera este tamaño; se
 * parte en llamadas más chicas (`chunkBlockRange`).
 */
export const MAX_LOG_BLOCK_RANGE = 50_000n;

/** Cada cuánto reintentar el descubrimiento de deals del vendedor. */
const POLL_INTERVAL_MS = 8000;

export interface BlockRangeChunk {
  fromBlock: bigint;
  toBlock: bigint;
}

/**
 * Parte `[fromBlock, toBlock]` (ambos inclusive) en ventanas de a lo sumo
 * `maxRange` bloques, en orden ascendente. Pura y sin red — la usa
 * `fetchSellerOrderRefs` para no mandar un `getContractEvents` con un rango
 * más grande de lo que algunos RPCs aceptan de una sola vez.
 */
export function chunkBlockRange(fromBlock: bigint, toBlock: bigint, maxRange: bigint): BlockRangeChunk[] {
  if (maxRange <= 0n) throw new Error("maxRange debe ser mayor a 0");
  if (toBlock < fromBlock) return [];
  const chunks: BlockRangeChunk[] = [];
  let start = fromBlock;
  while (start <= toBlock) {
    const end = start + maxRange - 1n < toBlock ? start + maxRange - 1n : toBlock;
    chunks.push({ fromBlock: start, toBlock: end });
    start = end + 1n;
  }
  return chunks;
}

/**
 * Combina los `orderRef` descubiertos on-chain (evento `Deposited` con
 * `seller` = cuenta local) con los trackeados a mano (link pegado en
 * "Agregar un pedido", o vistos antes en `/pedido/:ref`) sin duplicados, más
 * nuevo primero. El descubrimiento on-chain es best-effort — si la lectura
 * de logs falla (límite del RPC, red), `discovered` puede venir vacío y esta
 * función simplemente devuelve los trackeados: el agregado manual sigue
 * funcionando como fallback, nunca al revés.
 */
export function mergeSellerOrderRefs(discovered: Hex[], tracked: Hex[]): Hex[] {
  const seen = new Set<string>();
  const merged: Hex[] = [];
  // `discovered` llega en orden ascendente de bloque (más viejo primero, tal
  // como lo devuelve `getContractEvents`) — se invierte para listar el más
  // nuevo primero, igual que `tracked` (ya ordenado por `addedAt` desc).
  for (const ref of [...discovered].reverse()) {
    const key = ref.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(ref);
  }
  for (const ref of tracked) {
    const key = ref.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(ref);
  }
  return merged;
}

async function fetchSellerOrderRefs(seller: Address): Promise<Hex[]> {
  const client = getPublicClient();
  const { escrowAddress, deployBlock } = getDeploymentConfig();
  const latest = await client.getBlockNumber();
  const chunks = chunkBlockRange(deployBlock, latest, MAX_LOG_BLOCK_RANGE);

  const refs: Hex[] = [];
  for (const { fromBlock, toBlock } of chunks) {
    const logs = await client.getContractEvents({
      address: escrowAddress,
      abi: kuskaEscrowAbi,
      eventName: "Deposited",
      args: { seller },
      fromBlock,
      toBlock,
    });
    for (const log of logs) {
      if (log.args.orderRef) refs.push(log.args.orderRef);
    }
  }
  return refs;
}

/**
 * Descubre los `orderRef` de deals donde la cuenta local es vendedor,
 * leyendo el evento `Deposited` desde `deployBlock` — sin esto, `/vendedor`
 * dependía enteramente de pegar a mano el link que manda el comprador (riesgo
 * real en la demo en vivo, con una sola persona pasando un link de celular a
 * laptop). No crea ninguna cuenta: `seller` viene de `getAccount()` (sin
 * auto-crear) en quien llama a este hook — si todavía no hay cuenta local, el
 * hook queda deshabilitado (`enabled`).
 *
 * Se degrada con gracia a propósito: NO se atrapa el error acá adentro — si
 * `queryFn` falla (límite del RPC, red), react-query deja el `error`/`isError`
 * del resultado para que quien llame decida qué mostrar (un aviso chico, no
 * bloqueante) y siga usando los pedidos trackeados a mano mientras tanto.
 */
export function useSellerDeals(seller: Address | undefined) {
  return useQuery({
    queryKey: ["seller-deals", seller?.toLowerCase() ?? null],
    queryFn: () => fetchSellerOrderRefs(seller as Address),
    enabled: Boolean(seller),
    refetchInterval: POLL_INTERVAL_MS,
    retry: 1,
  });
}
