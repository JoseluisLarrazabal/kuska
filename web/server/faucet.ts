import { z } from "zod";
import type { Account, Address, Hex, PublicClient, WalletClient } from "viem";
import { mockUsdAbi } from "../src/lib/escrow/abi";
import { findRevertedError } from "./viemErrors";
import { isContractAddress } from "./contractGuard";

const faucetRequestSchema = z.object({
  to: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "dirección inválida"),
});

export interface FaucetDeps {
  publicClient: PublicClient;
  walletClient: WalletClient;
  relayerAccount: Account;
  tokenAddress: Address;
  /** en mainnet (177) el faucet no existe: 404 */
  chainId: number;
  /** default 20_000 ms (docs §6) */
  receiptTimeoutMs?: number;
  /**
   * Piso de saldo del relayer en wei antes de mandar CUALQUIER tx del
   * faucet. Default 0.02 HSK (20_000_000_000_000_000n wei), coherente con
   * `lowBalance` de `health.ts`. Las llaves de rol de esta demo tienen 0.1
   * HSK cada una: un faucet sin freno de saldo puede vaciarla en pocas
   * llamadas.
   */
  minRelayerBalanceWei?: bigint;
}

export type FaucetResponse =
  | { status: 200; body: { hash: Hex; blockNumber: string; status: "success" } }
  | { status: 400; body: { code: "INVALID_REQUEST" } }
  | { status: 404; body: { code: "NOT_FOUND" } }
  | { status: 409; body: { code: "FAUCET_COOLDOWN"; availableAt: string } }
  | { status: 409; body: { code: "SIMULATION_REVERTED"; reason: string } }
  | { status: 409; body: { code: "TX_REVERTED"; hash: Hex } }
  | { status: 429; body: { code: "RATE_LIMITED"; retryAfter: number } }
  | { status: 502; body: { code: "RPC_ERROR" } }
  | { status: 503; body: { code: "MISCONFIGURED" } }
  | { status: 503; body: { code: "RELAYER_LOW_BALANCE" } }
  | { status: 504; body: { code: "RECEIPT_TIMEOUT"; hash: Hex } };

/** 0.02 HSK — mismo umbral que `lowBalance` en health.ts (docs/escrow-interface.md §6). */
const DEFAULT_MIN_RELAYER_BALANCE_WEI = 20_000_000_000_000_000n;

// ---------------------------------------------------------------------------
// Rate limit por IP, en memoria de proceso, ventana deslizante. Único freno
// disponible sin dependencias externas ni estado compartido: el freno real
// (cooldown de `MockUSD`) es por DIRECCIÓN destino, así que un atacante con
// direcciones frescas ilimitadas lo esquiva sin límite y le hace gastar gas
// al relayer (0.1 HSK de saldo) en cada request.
//
// OJO — esto es mitigación best-effort, NO una garantía: en serverless
// (Vercel) cada instancia fría tiene su propio `Map` en memoria, así que un
// atacante que golpee varias instancias concurrentes (o que se beneficie de
// reinicios de instancia) puede superar el límite nominal. La garantía real
// requeriría estado compartido entre instancias (p. ej. Upstash Redis), que
// queda fuera de alcance para esta demo. Esto igual sube considerablemente
// el costo de un ataque trivial de "una IP, muchas direcciones nuevas".
// ---------------------------------------------------------------------------
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutos
const RATE_LIMIT_MAX_REQUESTS = 3; // por IP, por ventana

// Cota dura de IPs distintas retenidas en memoria a la vez. Sin esto, el
// `Map` sólo se poda para la IP que está pidiendo AHORA — las entradas de
// clientes que ya se fueron (su ventana expiró hace rato pero nunca volvieron
// a pedir) quedan colgadas en memoria toda la vida del proceso, así que la
// memoria crece con la cantidad de IPs distintas vistas, no con el tráfico
// concurrente real (hallazgo de revisión externa, Codex). 5000 es generoso
// para el tráfico de esta demo y acota el peor caso a un puñado de MB.
const RATE_LIMIT_MAX_TRACKED_IPS = 5000;

const requestTimestampsByIp = new Map<string, number[]>();

/**
 * Poda el `Map` de rate limit en dos pasadas:
 * 1) elimina las IPs cuya ventana ya expiró por completo (nadie de esa IP
 *    pidió nada en los últimos `RATE_LIMIT_WINDOW_MS`);
 * 2) si el `Map` sigue por encima de la cota dura, descarta las entradas más
 *    viejas hasta volver a estar bajo la cota.
 * `requestTimestampsByIp` siempre reinserta (delete + set) la IP que tocó en
 * cada pedido, así el orden de iteración del `Map` funciona como un LRU
 * aproximado (la primera clave es la menos usada recientemente) sin
 * estructuras de datos extra.
 */
function evictStaleRateLimitEntries(now: number): void {
  for (const [ip, timestamps] of requestTimestampsByIp) {
    const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (recent.length === 0) {
      requestTimestampsByIp.delete(ip);
    } else if (recent.length !== timestamps.length) {
      requestTimestampsByIp.set(ip, recent);
    }
  }

  while (requestTimestampsByIp.size > RATE_LIMIT_MAX_TRACKED_IPS) {
    const oldestIp = requestTimestampsByIp.keys().next().value;
    if (oldestIp === undefined) break;
    requestTimestampsByIp.delete(oldestIp);
  }
}

function checkRateLimit(
  ip: string,
  now: number = Date.now(),
): { limited: boolean; retryAfterSeconds: number } {
  evictStaleRateLimitEntries(now);

  const recent = (requestTimestampsByIp.get(ip) ?? []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS,
  );

  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    // delete + set (en vez de sólo set) para que esta IP quede como la más
    // recientemente tocada en el orden de iteración del Map — ver eviction
    // LRU en `evictStaleRateLimitEntries`.
    requestTimestampsByIp.delete(ip);
    requestTimestampsByIp.set(ip, recent);
    const oldest = recent[0] ?? now;
    const retryAfterMs = RATE_LIMIT_WINDOW_MS - (now - oldest);
    return { limited: true, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }

  recent.push(now);
  requestTimestampsByIp.delete(ip);
  requestTimestampsByIp.set(ip, recent);
  return { limited: false, retryAfterSeconds: 0 };
}

/** Solo para tests: limpia el rate limiter del faucet en memoria. */
export function resetFaucetRateLimiter(): void {
  requestTimestampsByIp.clear();
}

/** Solo para tests: cantidad de IPs actualmente trackeadas por el rate limiter. */
export function getFaucetRateLimiterSize(): number {
  return requestTimestampsByIp.size;
}

/**
 * `POST /api/faucet` (docs/escrow-interface.md §6).
 *
 * `clientIp` se recibe como parámetro (nunca se lee de headers acá): lo
 * resuelve el borde HTTP (`web/api/faucet.ts` con `getClientIp`, o
 * `web/server/devServer.ts` en dev) para que este handler siga siendo puro y
 * testeable sin construir un `Request` real.
 */
export async function handleFaucet(
  body: unknown,
  deps: FaucetDeps,
  clientIp: string,
): Promise<FaucetResponse> {
  if (deps.chainId === 177) {
    return { status: 404, body: { code: "NOT_FOUND" } };
  }

  const parsed = faucetRequestSchema.safeParse(body);
  if (!parsed.success) {
    return { status: 400, body: { code: "INVALID_REQUEST" } };
  }
  const to = parsed.data.to as Address;

  const rateLimit = checkRateLimit(clientIp);
  if (rateLimit.limited) {
    return {
      status: 429,
      body: { code: "RATE_LIMITED", retryAfter: rateLimit.retryAfterSeconds },
    };
  }

  // piso de saldo del relayer: con 0.1 HSK de saldo total en la llave del
  // relayer, mandar una tx que sabemos que no se puede pagar (o que deja al
  // relayer sin margen para el resto de la demo) es peor que rechazarla acá.
  const minBalance = deps.minRelayerBalanceWei ?? DEFAULT_MIN_RELAYER_BALANCE_WEI;
  let relayerBalance: bigint;
  try {
    relayerBalance = await deps.publicClient.getBalance({
      address: deps.relayerAccount.address,
    });
  } catch {
    // un RPC caído acá no puede escapar como 500 sin manejar — mismo
    // contrato 502 RPC_ERROR que el resto de las llamadas a RPC de este
    // handler (docs/escrow-interface.md §6).
    return { status: 502, body: { code: "RPC_ERROR" } };
  }
  if (relayerBalance < minBalance) {
    return { status: 503, body: { code: "RELAYER_LOW_BALANCE" } };
  }

  // la dirección del token debe ser realmente un contrato (memoizado por
  // proceso) antes de mandar ninguna transacción — ver contractGuard.ts. El
  // relayer ya mandó una tx de faucet a una dirección sin contrato en testnet.
  const tokenIsContract = await isContractAddress(deps.publicClient, deps.tokenAddress);
  if (!tokenIsContract) {
    return { status: 503, body: { code: "MISCONFIGURED" } };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let simulatedRequest: any;
  try {
    const simulated = await deps.publicClient.simulateContract({
      address: deps.tokenAddress,
      abi: mockUsdAbi,
      account: deps.relayerAccount,
      functionName: "faucet",
      args: [to],
    });
    simulatedRequest = simulated.request;
  } catch (err) {
    const reverted = findRevertedError(err);
    if (reverted?.data?.errorName === "FaucetCooldown") {
      const availableAt = reverted.data.args?.[0];
      return {
        status: 409,
        body: { code: "FAUCET_COOLDOWN", availableAt: String(availableAt ?? "0") },
      };
    }
    // cualquier OTRO revert de simulación (token pausado, un custom error
    // renombrado, `faucet()` inexistente, etc.) se reporta con su nombre real
    // en vez de aplanarse a un genérico 502 RPC_ERROR — igual que `relay.ts`.
    if (reverted) {
      const reason = reverted.data?.errorName ?? reverted.reason ?? "UNKNOWN";
      return { status: 409, body: { code: "SIMULATION_REVERTED", reason } };
    }
    return { status: 502, body: { code: "RPC_ERROR" } };
  }

  let hash: Hex;
  try {
    hash = await deps.walletClient.writeContract({
      ...simulatedRequest,
      account: deps.relayerAccount,
      chain: deps.walletClient.chain,
    });
  } catch {
    return { status: 502, body: { code: "RPC_ERROR" } };
  }

  // esperar el receipt: una tx que revierte on-chain (tras pasar la
  // simulación) no puede reportarse como éxito — ver docs/escrow-interface.md §6.
  try {
    const receipt = await deps.publicClient.waitForTransactionReceipt({
      hash,
      timeout: deps.receiptTimeoutMs ?? 20_000,
    });
    if (receipt.status !== "success") {
      return { status: 409, body: { code: "TX_REVERTED", hash } };
    }
    return {
      status: 200,
      body: { hash, blockNumber: receipt.blockNumber.toString(), status: "success" },
    };
  } catch {
    return { status: 504, body: { code: "RECEIPT_TIMEOUT", hash } };
  }
}
