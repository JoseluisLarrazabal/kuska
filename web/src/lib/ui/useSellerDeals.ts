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

export interface SellerScanState {
  /** Último bloque completamente escaneado (inclusive), o `-1n` si todavía no se escaneó nada. */
  cursor: bigint;
  /** `orderRef` acumulados, en orden ascendente de bloque (igual que devuelve `getContractEvents`). */
  refs: Hex[];
}

/**
 * Avanza un escaneo incremental de `[prev.cursor + 1, latest]` en chunks de a
 * lo sumo `maxRange` bloques, pidiendo cada chunk con `fetchChunk`. Pura en
 * el sentido de que toda I/O real vive en `fetchChunk` (inyectado) — esto es
 * lo que la hace testeable sin mockear el cliente RPC.
 *
 * Antes, cada poll (~8s) volvía a leer TODO el rango `[deployBlock, latest]`
 * desde cero, secuencialmente: además de desperdiciar llamadas RPC en cada
 * vuelta, un solo chunk que fallara (límite del RPC, blip de red) tiraba
 * TODO el resultado del poll — incluidos los refs de chunks anteriores que sí
 * se habían leído bien en esa misma vuelta. Acá el cursor solo avanza
 * después de que un chunk resuelve con éxito (`onChunkDone`, llamado antes de
 * que el chunk siguiente pueda fallar), así que si el `n`-ésimo chunk falla,
 * los `n-1` anteriores ya quedaron guardados — nunca se pierde progreso
 * parcial, ni dentro del mismo poll ni entre polls consecutivos.
 */
export async function scanSellerOrderRefsFromCursor(
  prev: SellerScanState,
  latest: bigint,
  maxRange: bigint,
  fetchChunk: (fromBlock: bigint, toBlock: bigint) => Promise<Hex[]>,
  onChunkDone?: (next: SellerScanState) => void,
): Promise<SellerScanState> {
  const fromBlock = prev.cursor + 1n;
  if (fromBlock > latest) return prev;

  const chunks = chunkBlockRange(fromBlock, latest, maxRange);
  let refs = prev.refs;
  let cursor = prev.cursor;
  for (const chunk of chunks) {
    const chunkRefs = await fetchChunk(chunk.fromBlock, chunk.toBlock);
    refs = refs.concat(chunkRefs);
    cursor = chunk.toBlock;
    onChunkDone?.({ cursor, refs });
  }
  return { cursor, refs };
}

/**
 * Estado de escaneo acumulado por vendedor + escrow (nunca por vendedor
 * solo: direcciones podrían repetirse entre despliegues/redes distintos).
 * Vive a nivel de módulo — no en el `queryFn` de react-query, que se vuelve a
 * invocar desde cero en cada poll y no tiene memoria propia entre llamadas —
 * para que el cursor y los refs acumulados sobrevivan entre polls. Cambiar de
 * vendedor local usa una key nueva automáticamente, así que no hace falta
 * "resetear" nada a mano: ese vendedor simplemente arranca sin estado previo.
 */
const sellerScanCache = new Map<string, SellerScanState>();

function sellerScanCacheKey(escrowAddress: Address, seller: Address): string {
  return `${escrowAddress.toLowerCase()}:${seller.toLowerCase()}`;
}

async function fetchSellerOrderRefs(seller: Address): Promise<Hex[]> {
  const client = getPublicClient();
  const { escrowAddress, deployBlock } = getDeploymentConfig();

  // `deployBlock` en 0 (env mal configurado, o directamente ausente) haría
  // que cada poll intente escanear ~33M de bloques desde el génesis — carísimo
  // y probablemente rechazado por el RPC de una. Se salta el descubrimiento
  // on-chain (el `isError` que esto produce ya dispara, sin cambios, el
  // aviso no bloqueante existente en `Seller.tsx`: "no pudimos leer
  // automáticamente…" — el agregado a mano sigue funcionando igual).
  if (deployBlock <= 0n) {
    throw new Error(
      "VITE_DEPLOY_BLOCK inválido (0 o sin configurar): no se puede escanear desde el bloque 0.",
    );
  }

  const key = sellerScanCacheKey(escrowAddress, seller);
  const prev = sellerScanCache.get(key) ?? { cursor: deployBlock - 1n, refs: [] };
  const latest = await client.getBlockNumber();

  const next = await scanSellerOrderRefsFromCursor(
    prev,
    latest,
    MAX_LOG_BLOCK_RANGE,
    async (fromBlock, toBlock) => {
      const logs = await client.getContractEvents({
        address: escrowAddress,
        abi: kuskaEscrowAbi,
        eventName: "Deposited",
        args: { seller },
        fromBlock,
        toBlock,
      });
      const chunkRefs: Hex[] = [];
      for (const log of logs) {
        if (log.args.orderRef) chunkRefs.push(log.args.orderRef);
      }
      return chunkRefs;
    },
    // Persistir el progreso de CADA chunk ya resuelto, no solo el resultado
    // final — si un chunk más adelante en esta misma vuelta falla, el
    // `await` de acá arriba nunca llega a devolver `next`, así que sin este
    // callback el progreso de los chunks previos se perdía igual.
    (state) => sellerScanCache.set(key, state),
  );
  sellerScanCache.set(key, next);
  return next.refs;
}

/**
 * Descubre los `orderRef` de deals donde la cuenta local es vendedor,
 * leyendo el evento `Deposited` desde `deployBlock` la primera vez y, de ahí
 * en más, solo el rango nuevo desde el último bloque escaneado
 * (`scanSellerOrderRefsFromCursor`/`sellerScanCache`) — sin esto, `/vendedor`
 * dependía enteramente de pegar a mano el link que manda el comprador (riesgo
 * real en la demo en vivo, con una sola persona pasando un link de celular a
 * laptop). No crea ninguna cuenta: `seller` viene de `getAccount()` (sin
 * auto-crear) en quien llama a este hook — si todavía no hay cuenta local, el
 * hook queda deshabilitado (`enabled`).
 *
 * Se degrada con gracia a propósito: NO se atrapa el error acá adentro — si
 * `queryFn` falla (límite del RPC, red, o un `deployBlock` inválido — ver
 * `fetchSellerOrderRefs`), react-query deja el `error`/`isError` del
 * resultado para que quien llame decida qué mostrar (un aviso chico, no
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
