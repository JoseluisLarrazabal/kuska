import type { Address, Hex } from "viem";
import { describeEscrowError } from "../escrow/errors";

// ---------------------------------------------------------------------------
// Formas de request espejo de `docs/escrow-interface.md` §6. No se importan
// los esquemas de `server/relay.ts` a propósito: ese módulo trae `zod` y
// dependencias de servidor que no deben terminar en el bundle del cliente.
// ---------------------------------------------------------------------------

export type RelayRequestBody =
  | {
      action: "deposit";
      params: {
        orderRef: Hex;
        buyer: Address;
        seller: Address;
        amount: string;
        deliveryDeadline: string;
        authDeadline: string;
        authSig: Hex;
        permitDeadline: string;
        permitSig: Hex;
      };
    }
  | {
      action: "claim" | "cancel";
      params: { orderRef: Hex; sigDeadline: string; sellerSig: Hex };
    }
  | {
      action: "release" | "dispute";
      params: { orderRef: Hex; sigDeadline: string; buyerSig: Hex };
    }
  | {
      action: "refundExpired" | "releaseAfterWindow";
      params: { orderRef: Hex };
    };

export interface RelaySuccess {
  hash: Hex;
  blockNumber: string;
  status: "success";
}

export interface RelayOutcomeError {
  code: string;
  message: string;
  hash?: Hex;
}

export type RelayOutcome =
  | { ok: true; data: RelaySuccess }
  | { ok: false; error: RelayOutcomeError };

// Mensajes para códigos que no son un custom error de contrato (esos se
// traducen con `describeEscrowError`). Se incluye un fallback genérico para
// cualquier código que el relayer devuelva y todavía no conozcamos acá
// (p. ej. un futuro `TX_REVERTED`, o un 503 de mantenimiento): nunca se deja
// un spinner infinito ni se revienta la UI por un código desconocido.
const RELAY_ERROR_MESSAGES: Record<string, string> = {
  INVALID_REQUEST: "La solicitud no tiene el formato esperado. Volvé a intentar desde el principio.",
  INVALID_SIGNATURE: "La firma no coincide con lo esperado. Volvé a confirmar la operación.",
  RPC_ERROR: "No se pudo hablar con la red ahora mismo. Probá de nuevo en unos segundos.",
  RECEIPT_TIMEOUT:
    "La transacción se envió pero todavía no se confirmó. Revisá el código de comprobante en el explorer.",
  TX_REVERTED: "La transacción se revirtió en la red: no se aplicó ningún cambio.",
  NOT_FOUND: "Esta función no está disponible en esta red.",
  NETWORK_ERROR: "No hay conexión con el servidor. Revisá tu internet e intentá de nuevo.",
};

const DEFAULT_RELAY_MESSAGE = "La operación no se pudo completar. Intentá de nuevo.";

// Códigos (docs/escrow-interface.md §6) cuya respuesta puede llegar DESPUÉS de
// que el relayer ya mandó la transacción: `TX_REVERTED` (409, la tx minada
// revirtió) y `RECEIPT_TIMEOUT` (504, se mandó pero no llegó a confirmarse
// dentro del timeout — puede terminar confirmando igual). Nunca se clasifica
// por texto del mensaje (decisión D41): siempre por el código.
const TX_MAYBE_SENT_CODES = new Set(["TX_REVERTED", "RECEIPT_TIMEOUT"]);

/**
 * ¿Esta falla del relayer pudo haber llegado a mandar (o dejar pendiente de
 * confirmar) una transacción on-chain? Si trae `hash`, seguro que sí. Si no,
 * solo los dos códigos ambiguos de arriba. El resto (validación, firma
 * inválida, simulación revertida, rate-limit, red, mal configurado) nunca
 * llegó a `writeContract` — no hay nada que rastrear.
 */
export function relayErrorMaybeSentTx(error: RelayOutcomeError): boolean {
  return error.hash !== undefined || TX_MAYBE_SENT_CODES.has(error.code);
}

function describeRelayError(body: Record<string, unknown>): string {
  const code = typeof body.code === "string" ? body.code : undefined;
  if (code === "SIMULATION_REVERTED") {
    return describeEscrowError(typeof body.reason === "string" ? body.reason : undefined);
  }
  if (code && code in RELAY_ERROR_MESSAGES) return RELAY_ERROR_MESSAGES[code] as string;
  return DEFAULT_RELAY_MESSAGE;
}

async function parseJsonSafe(response: Response): Promise<Record<string, unknown>> {
  try {
    const json: unknown = await response.json();
    return json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** `POST /api/relay`. Nunca lanza: siempre resuelve a un resultado explícito. */
export async function postRelay(body: RelayRequestBody): Promise<RelayOutcome> {
  let response: Response;
  try {
    response = await fetch("/api/relay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return {
      ok: false,
      error: { code: "NETWORK_ERROR", message: RELAY_ERROR_MESSAGES.NETWORK_ERROR as string },
    };
  }

  const json = await parseJsonSafe(response);
  if (response.ok) {
    return { ok: true, data: json as unknown as RelaySuccess };
  }

  const code = typeof json.code === "string" ? json.code : `HTTP_${response.status}`;
  const hash = typeof json.hash === "string" ? (json.hash as Hex) : undefined;
  return { ok: false, error: { code, message: describeRelayError(json), hash } };
}

// ---------------------------------------------------------------------------
// Faucet
// ---------------------------------------------------------------------------

export type FaucetOutcome =
  | { ok: true; hash: Hex }
  | { ok: false; code: string; message: string; availableAt?: number };

export async function postFaucet(to: Address): Promise<FaucetOutcome> {
  let response: Response;
  try {
    response = await fetch("/api/faucet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to }),
    });
  } catch {
    return {
      ok: false,
      code: "NETWORK_ERROR",
      message: RELAY_ERROR_MESSAGES.NETWORK_ERROR as string,
    };
  }

  const json = await parseJsonSafe(response);
  if (response.ok) {
    return { ok: true, hash: json.hash as Hex };
  }

  const code = typeof json.code === "string" ? json.code : `HTTP_${response.status}`;
  if (code === "FAUCET_COOLDOWN") {
    const availableAt = typeof json.availableAt === "string" ? Number(json.availableAt) : undefined;
    return {
      ok: false,
      code,
      message: "El faucet tiene un enfriamiento de 1 hora: todavía no podés volver a pedir fondos.",
      availableAt,
    };
  }
  if (code === "NOT_FOUND") {
    return { ok: false, code, message: "El faucet no está disponible en esta red." };
  }
  return { ok: false, code, message: DEFAULT_RELAY_MESSAGE };
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export interface HealthOutcome {
  chainId: number;
  relayer: Address;
  relayerBalanceWei: bigint;
  escrow: Address;
  token: Address;
  lowBalance: boolean;
}

export async function getHealth(): Promise<HealthOutcome | undefined> {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) return undefined;
    const json = (await response.json()) as {
      chainId: number;
      relayer: Address;
      relayerBalanceWei: string;
      escrow: Address;
      token: Address;
      lowBalance: boolean;
    };
    return { ...json, relayerBalanceWei: BigInt(json.relayerBalanceWei) };
  } catch {
    return undefined;
  }
}
