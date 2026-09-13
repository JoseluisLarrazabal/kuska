import type { FaucetOutcome } from "./relayer";

// ---------------------------------------------------------------------------
// Extraído de `Demo.tsx` (`armDemoDeal`) para que la decisión de fondeo se
// pueda testear con vitest en node, sin montar React ni pegarle a un RPC/
// relayer real. Puro y con todo inyectado: `getBalance`/`requestFaucet` los
// arma el caller (`Demo.tsx`) con el `PublicClient`/`postFaucet` reales; los
// tests inyectan fakes y un `sleep` sincrónico para que el polling no tarde
// segundos de verdad.
// ---------------------------------------------------------------------------

export interface EnsureDemoFundsParams {
  /** Monto mínimo requerido, en unidades mínimas del token (mUSD, 6 decimales). */
  amount: bigint;
  /** Lee el saldo actual del comprador. */
  getBalance: () => Promise<bigint>;
  /** Pide fondos al faucet para el comprador. */
  requestFaucet: () => Promise<FaucetOutcome>;
  /** Inyectable para tests: por defecto, `setTimeout` real. */
  sleep?: (ms: number) => Promise<void>;
  /** Cantidad de relecturas de saldo tras un faucet exitoso (default 6). */
  maxPolls?: number;
  /** Espera entre relecturas, en ms (default 1000). */
  pollMs?: number;
  /**
   * Se llama una sola vez, justo antes de pedirle al faucet — nunca si el
   * saldo ya alcanzaba. Pensado para que el caller muestre un indicador de
   * progreso ("Acreditando mUSD de prueba…") mientras dura el fondeo.
   */
  onFunding?: () => void;
}

export type EnsureDemoFundsResult =
  | { ok: true; funded: boolean }
  | { ok: false; reason: "faucet_failed"; faucet: Extract<FaucetOutcome, { ok: false }> }
  | { ok: false; reason: "balance_not_visible" };

const DEFAULT_MAX_POLLS = 6;
const DEFAULT_POLL_MS = 1000;

/**
 * Garantiza que el comprador tenga al menos `amount` de mUSD antes de armar
 * un deal de demo. Si ya alcanza, no toca el faucet. Si no alcanza, pide al
 * faucet y espera (con un polling acotado) a que el saldo nuevo sea visible
 * para el RPC público que usa el browser — el nodo del relayer ya confirmó
 * el receipt antes de responder (`server/faucet.ts`), pero el RPC público
 * puede tardar en reflejar ese mismo estado (nodo/replica distinta).
 */
export async function ensureDemoFunds(
  params: EnsureDemoFundsParams,
): Promise<EnsureDemoFundsResult> {
  const {
    amount,
    getBalance,
    requestFaucet,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    maxPolls = DEFAULT_MAX_POLLS,
    pollMs = DEFAULT_POLL_MS,
    onFunding,
  } = params;

  const initialBalance = await getBalance();
  if (initialBalance >= amount) {
    return { ok: true, funded: false };
  }

  onFunding?.();

  const faucet = await requestFaucet();
  if (!faucet.ok) {
    return { ok: false, reason: "faucet_failed", faucet };
  }

  for (let attempt = 0; attempt < maxPolls; attempt++) {
    try {
      const balance = await getBalance();
      if (balance >= amount) {
        return { ok: true, funded: true };
      }
    } catch {
      // Una relectura fallida durante el polling (RPC caído, 429, timeout)
      // NO aborta: se trata igual que "todavía no visible" y se sigue
      // reintentando — el faucet ya se pidió, así que cortar acá tira el
      // trabajo hecho por un error transitorio de lectura. Si todos los
      // intentos fallan/no alcanzan, se agota `maxPolls` igual que si el
      // saldo simplemente nunca apareciera (`balance_not_visible` abajo). La
      // lectura INICIAL (antes del faucet) es distinta a propósito: ahí un
      // error SÍ se propaga (ver más arriba) porque no hay forma segura de
      // decidir si hace falta pedir fondos con un saldo desconocido.
    }
    if (attempt < maxPolls - 1) {
      await sleep(pollMs);
    }
  }

  return { ok: false, reason: "balance_not_visible" };
}
