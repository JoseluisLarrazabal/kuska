import type { Address, Hex } from "viem";
import { describeEscrowError } from "../escrow/errors";
import { formatUnixTime } from "./format";

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

// Lista de códigos que PRUEBAN que `writeContract` nunca se llamó — los
// únicos casos donde es seguro asumir que no se mandó ninguna tx. Derivado de
// leer `server/relay.ts` línea por línea, ANTES de cada `return`, relativo al
// único `writeContract` del pipeline (`writeWithNonceRetry`, paso 4):
//
//   - `INVALID_REQUEST`: `relayRequestSchema.safeParse` falla (relay.ts:391)
//     — antes de cualquier llamada a la red.
//   - `INVALID_SIGNATURE`: `verifySignature` da `false` (relay.ts:415) o
//     `buildContractCall` tira, p. ej. `permitSig` malformado (relay.ts:423)
//     — ambos antes de `simulateContract`/`writeContract`.
//   - `SIMULATION_REVERTED`: `simulateContract` revierte (relay.ts:441) —
//     `simulateContract` es un `eth_call` de solo lectura, nunca manda una tx.
//   - `MISCONFIGURED`: el escrow no tiene bytecode (relay.ts:406) — o, en
//     `api/relay.ts:35`, `getServerConfig`/`getRelayerClients` tiran ANTES de
//     construir `RelayDeps` y de que `handleRelay` corra un solo paso.
//
// `RPC_ERROR` (502) queda AFUERA de esta lista a propósito, aunque también se
// devuelve antes de mandar la tx en tres lugares (relay.ts:404 `isContractAddress`,
// :413 `verifySignature`, :443 `simulateContract` no-revert): el MISMO código
// se devuelve en relay.ts:451, dentro del catch de `writeWithNonceRetry`, es
// decir DESPUÉS de haber intentado `writeContract` (p. ej. el nodo aceptó la
// tx pero la llamada RPC que esperaba la respuesta expiró). Como se clasifica
// solo por código (nunca por dónde se originó ni por texto — decisión D41),
// `RPC_ERROR` tiene que tratarse como "puede haber mandado" siempre.
//
// Tampoco entran acá los códigos que arma el CLIENTE (nunca vienen de
// `handleRelay`): `NETWORK_ERROR` (el `fetch` tira — puede ser que el server
// ya haya mandado la tx y la respuesta nunca llegó, p. ej. el cliente perdió
// conexión) y cualquier `HTTP_<status>` (respuesta sin JSON parseable — el
// caso real es un timeout de plataforma de Vercel: `api/relay.ts` declara
// `maxDuration: 30`, pero el pipeline puede tardar más — hasta 20s solo en
// `waitForTransactionReceipt`, más las llamadas RPC previas —, así que
// Vercel puede cortar la función a mitad de camino, DESPUÉS de que
// `writeContract` ya mandó la tx, y el cliente recibe un 504 sin cuerpo).
//
// Cualquier código futuro y desconocido tampoco entra en la lista: rastrear
// de más un pedido que nunca se fondeó es inofensivo (la página del pedido
// simplemente lo muestra como no encontrado); rastrear de menos uno que sí se
// fondeó deja plata en custodia sin que nadie la vea. Se prefiere el primer
// error.
const RELAY_DEFINITELY_NOT_SENT_CODES = new Set([
  "INVALID_REQUEST",
  "INVALID_SIGNATURE",
  "SIMULATION_REVERTED",
  "MISCONFIGURED",
]);

/**
 * ¿Esta falla del relayer pudo haber llegado a mandar (o dejar pendiente de
 * confirmar) una transacción on-chain? Deny-by-default invertido: se
 * considera que SÍ pudo haber mandado la tx salvo que el código pruebe lo
 * contrario (ver `RELAY_DEFINITELY_NOT_SENT_CODES` arriba). Si trae `hash`,
 * ya se sabe que sí. Nunca se clasifica por texto del mensaje (decisión D41).
 */
export function relayErrorMaybeSentTx(error: RelayOutcomeError): boolean {
  if (error.hash !== undefined) return true;
  return !RELAY_DEFINITELY_NOT_SENT_CODES.has(error.code);
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

/**
 * Arma el mensaje de una falla del faucet, agregando la hora de reapertura
 * solo cuando `availableAt` es un dato utilizable. `availableAt` puede llegar
 * `0` (el revert `FaucetCooldown` sin argumento decodificado, ver
 * `server/faucet.ts`) o `NaN` (`postFaucet` lo parsea con `Number(...)`, que
 * da `NaN` si el campo no era un string numérico) — en ambos casos "Disponible
 * a las Invalid Date" sería peor que mostrar el mensaje sin la hora. Usada
 * tanto por `requestFaucet` (Faucet manual) como por `armDemoDeal` (faucet
 * automático de `/demo`) para que ambos caminos queden consistentes.
 */
export function describeFaucetFailure(outcome: Extract<FaucetOutcome, { ok: false }>): string {
  if (
    outcome.code === "FAUCET_COOLDOWN" &&
    Number.isFinite(outcome.availableAt) &&
    (outcome.availableAt as number) > 0
  ) {
    return `${outcome.message} Disponible a las ${formatUnixTime(outcome.availableAt as number)}.`;
  }
  return outcome.message;
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
