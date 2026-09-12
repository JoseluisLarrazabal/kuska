import { z } from "zod";
import {
  parseSignature,
  type Account,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { kuskaEscrowAbi } from "../src/lib/escrow/abi";
import { getDeal } from "../src/lib/escrow/read";
import {
  buildCancel,
  buildDeliveryClaim,
  buildDeliveryConfirmation,
  buildDepositAuthorization,
  buildDispute,
} from "../src/lib/escrow/typedData";
import { findRevertedError, isNonceError } from "./viemErrors";
import { isContractAddress } from "./contractGuard";

// ---------------------------------------------------------------------------
// Esquemas por acción (docs/escrow-interface.md §6). uint256/uint64 viajan
// como string decimal (§4); direcciones, bytes32 y firmas como hex 0x….
// ---------------------------------------------------------------------------

const hexBytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "bytes32 inválido");
const hexAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "dirección inválida");
// Firma flexible para authSig/sellerSig/buyerSig: cualquier hex `0x` de
// longitud PAR (cada par de hex es un byte completo), con un mínimo razonable
// (64 hex = 32 bytes) y un máximo defensivo (8192 hex = 4096 bytes). No fijar
// esto a 64-65 bytes (ECDSA) rompería firmas ERC-1271 de smart accounts, que
// son de longitud arbitraria.
const hexSignature = z
  .string()
  .regex(/^0x(?:[0-9a-fA-F]{2}){32,4096}$/, "firma inválida (hex par, 64-8192 caracteres)");
// firma del permit (EIP-2612): siempre EOA, se descompone en v/r/s vía
// `parseSignature`, así que sí debe ser exactamente 65 bytes (130 hex).
const permitSignature = z
  .string()
  .regex(/^0x[0-9a-fA-F]{130}$/, "firma de permit inválida (esperado 65 bytes)");
// `decimalString` genérico (sin cota) permitía, p. ej., un `deliveryDeadline`
// (uint64 en la firma ABI de `depositWithPermit`) mayor que
// `type(uint64).max`: el schema lo aceptaba, pero `simulateContract` tira
// `IntegerOutOfRangeError` al codificar el calldata (no un revert de
// contrato), `findRevertedError` devuelve `undefined`, y un input malo del
// cliente terminaba como `502 RPC_ERROR` en vez de `400`. Cada campo numérico
// se acota ahora a su rango real según el tipo Solidity del parámetro ABI
// correspondiente (ver src/lib/escrow/abi.ts).
const UINT64_MAX = (1n << 64n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;

// 78 = cantidad de dígitos decimales de `type(uint256).max` (el tipo más
// grande que se acota acá): una cota de LARGO de string ANTES del `.transform`
// que hace `BigInt(v)`. Sin esto, un POST no autenticado con un string de
// millones de dígitos fuerza un parseo de BigInt super-lineal (bloqueante)
// ANTES de que el `.refine` de abajo tenga chance de rechazarlo — la cota de
// tamaño tiene que ir en el string, no después del parseo.
const MAX_UINT256_DECIMAL_DIGITS = 78;

function boundedDecimalString(max: bigint, typeLabel: string) {
  return z
    .string()
    .regex(/^\d+$/, "debe ser un entero decimal en formato string")
    .max(MAX_UINT256_DECIMAL_DIGITS, `cadena numérica demasiado larga para ${typeLabel}`)
    .transform((v) => BigInt(v))
    .refine((v) => v <= max, `excede el máximo permitido para ${typeLabel}`);
}

const decimalStringUint64 = boundedDecimalString(UINT64_MAX, "uint64");
const decimalStringUint256 = boundedDecimalString(UINT256_MAX, "uint256");

const depositParamsSchema = z.object({
  orderRef: hexBytes32,
  buyer: hexAddress,
  seller: hexAddress,
  amount: decimalStringUint256,
  deliveryDeadline: decimalStringUint64,
  authDeadline: decimalStringUint256,
  authSig: hexSignature,
  permitDeadline: decimalStringUint256,
  permitSig: permitSignature,
});

const sellerActionParamsSchema = z.object({
  orderRef: hexBytes32,
  sigDeadline: decimalStringUint256,
  sellerSig: hexSignature,
});

const buyerActionParamsSchema = z.object({
  orderRef: hexBytes32,
  sigDeadline: decimalStringUint256,
  buyerSig: hexSignature,
});

const orderRefOnlyParamsSchema = z.object({
  orderRef: hexBytes32,
});

export const relayRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("deposit"), params: depositParamsSchema }),
  z.object({ action: z.literal("claim"), params: sellerActionParamsSchema }),
  z.object({ action: z.literal("cancel"), params: sellerActionParamsSchema }),
  z.object({ action: z.literal("release"), params: buyerActionParamsSchema }),
  z.object({ action: z.literal("dispute"), params: buyerActionParamsSchema }),
  z.object({ action: z.literal("refundExpired"), params: orderRefOnlyParamsSchema }),
  z.object({ action: z.literal("releaseAfterWindow"), params: orderRefOnlyParamsSchema }),
]);

export type RelayRequest = z.infer<typeof relayRequestSchema>;

// ---------------------------------------------------------------------------
// Dependencias inyectables (para poder mockear en tests)
// ---------------------------------------------------------------------------

export interface RelayDeps {
  publicClient: PublicClient;
  walletClient: WalletClient;
  relayerAccount: Account;
  escrowAddress: Address;
  chainId: number;
  /** default 20_000 ms (docs §6) */
  receiptTimeoutMs?: number;
  /**
   * Cuántas veces reintentar `writeContract` ante un error de nonce, DESPUÉS
   * del intento inicial (no intentos totales). Default 2 (docs §6) → hasta 3
   * llamadas a `writeContract` en total (1 intento inicial + 2 reintentos).
   */
  maxNonceRetries?: number;
}

// ---------------------------------------------------------------------------
// Respuestas EXACTAS de la interfaz (§6)
// ---------------------------------------------------------------------------

export type RelayResponse =
  | { status: 200; body: { hash: Hex; blockNumber: string; status: "success" } }
  | { status: 400; body: { code: "INVALID_REQUEST" | "INVALID_SIGNATURE" } }
  | { status: 409; body: { code: "SIMULATION_REVERTED"; reason: string } }
  | { status: 409; body: { code: "TX_REVERTED"; hash: Hex } }
  | { status: 502; body: { code: "RPC_ERROR" } }
  | { status: 503; body: { code: "MISCONFIGURED" } }
  | { status: 504; body: { code: "RECEIPT_TIMEOUT"; hash: Hex } };

function invalidRequest(): RelayResponse {
  return { status: 400, body: { code: "INVALID_REQUEST" } };
}

function invalidSignature(): RelayResponse {
  return { status: 400, body: { code: "INVALID_SIGNATURE" } };
}

function rpcError(): RelayResponse {
  return { status: 502, body: { code: "RPC_ERROR" } };
}

function misconfigured(): RelayResponse {
  return { status: 503, body: { code: "MISCONFIGURED" } };
}

// ---------------------------------------------------------------------------
// Paso 2: verificación EIP-712 off-chain contra el firmante esperado
// ---------------------------------------------------------------------------

async function verifySignature(request: RelayRequest, deps: RelayDeps): Promise<boolean> {
  const { action, params } = request;
  const base = { chainId: deps.chainId, verifyingContract: deps.escrowAddress };

  switch (action) {
    case "deposit": {
      const typedData = buildDepositAuthorization({
        ...base,
        orderRef: params.orderRef as Hex,
        seller: params.seller as Address,
        amount: params.amount,
        deliveryDeadline: params.deliveryDeadline,
        authDeadline: params.authDeadline,
      });
      return deps.publicClient.verifyTypedData({
        address: params.buyer as Address,
        ...typedData,
        signature: params.authSig as Hex,
      });
    }
    case "claim": {
      const deal = await getDeal(deps.publicClient, deps.escrowAddress, params.orderRef as Hex);
      const typedData = buildDeliveryClaim({
        ...base,
        orderRef: params.orderRef as Hex,
        sigDeadline: params.sigDeadline,
      });
      return deps.publicClient.verifyTypedData({
        address: deal.seller,
        ...typedData,
        signature: params.sellerSig as Hex,
      });
    }
    case "cancel": {
      const deal = await getDeal(deps.publicClient, deps.escrowAddress, params.orderRef as Hex);
      const typedData = buildCancel({
        ...base,
        orderRef: params.orderRef as Hex,
        sigDeadline: params.sigDeadline,
      });
      return deps.publicClient.verifyTypedData({
        address: deal.seller,
        ...typedData,
        signature: params.sellerSig as Hex,
      });
    }
    case "release": {
      const deal = await getDeal(deps.publicClient, deps.escrowAddress, params.orderRef as Hex);
      const typedData = buildDeliveryConfirmation({
        ...base,
        orderRef: params.orderRef as Hex,
        sigDeadline: params.sigDeadline,
      });
      return deps.publicClient.verifyTypedData({
        address: deal.buyer,
        ...typedData,
        signature: params.buyerSig as Hex,
      });
    }
    case "dispute": {
      const deal = await getDeal(deps.publicClient, deps.escrowAddress, params.orderRef as Hex);
      const typedData = buildDispute({
        ...base,
        orderRef: params.orderRef as Hex,
        sigDeadline: params.sigDeadline,
      });
      return deps.publicClient.verifyTypedData({
        address: deal.buyer,
        ...typedData,
        signature: params.buyerSig as Hex,
      });
    }
    case "refundExpired":
    case "releaseAfterWindow":
      // no requieren firma (docs §3 tabla de funciones)
      return true;
  }
}

// ---------------------------------------------------------------------------
// Paso 3-4: simulateContract + writeContract, dispatch dinámico por acción
// ---------------------------------------------------------------------------

interface ContractCall {
  functionName: string;
  args: readonly unknown[];
}

function buildContractCall(request: RelayRequest): ContractCall {
  const { action, params } = request;
  switch (action) {
    case "deposit": {
      const { r, s, v, yParity } = parseSignature(params.permitSig as Hex);
      const vValue = v ?? BigInt(yParity + 27);
      return {
        functionName: "depositWithPermit",
        args: [
          params.orderRef,
          params.buyer,
          params.seller,
          params.amount,
          params.deliveryDeadline,
          params.authDeadline,
          params.authSig,
          params.permitDeadline,
          vValue,
          r,
          s,
        ],
      };
    }
    case "claim":
      return {
        functionName: "claimDelivery",
        args: [params.orderRef, params.sigDeadline, params.sellerSig],
      };
    case "cancel":
      return {
        functionName: "cancel",
        args: [params.orderRef, params.sigDeadline, params.sellerSig],
      };
    case "release":
      return {
        functionName: "release",
        args: [params.orderRef, params.sigDeadline, params.buyerSig],
      };
    case "dispute":
      return {
        functionName: "dispute",
        args: [params.orderRef, params.sigDeadline, params.buyerSig],
      };
    case "refundExpired":
      return { functionName: "refundExpired", args: [params.orderRef] };
    case "releaseAfterWindow":
      return { functionName: "releaseAfterWindow", args: [params.orderRef] };
  }
}

// ---------------------------------------------------------------------------
// Paso 4 + 6: writeContract con reintento ante error de nonce (hasta 2
// reintentos tras el intento inicial — 3 llamadas totales como máximo —,
// nonce "pending", con hasta 250ms de espera entre intentos)
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeWithNonceRetry(
  deps: RelayDeps,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  request: any,
): Promise<Hex> {
  // `maxRetries` es la cantidad de REINTENTOS tras el intento inicial (no el
  // total de intentos): con el default 2, se hacen hasta 3 llamadas a
  // `writeContract` (attempt 0..2 inclusive).
  const maxRetries = deps.maxNonceRetries ?? 2;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await sleep(250); // <= 500ms entre reintentos (docs §6)
    try {
      const nonce = await deps.publicClient.getTransactionCount({
        address: deps.relayerAccount.address,
        blockTag: "pending",
      });
      return await deps.walletClient.writeContract({
        ...request,
        account: deps.relayerAccount,
        chain: deps.walletClient.chain,
        nonce,
      });
    } catch (err) {
      lastError = err;
      if (!isNonceError(err)) throw err;
      // reintentar con un nonce "pending" fresco
    }
  }

  // con `maxNonceRetries` >= 0 el loop de arriba corre al menos una vez
  // (attempt 0) y `lastError` queda seteado; este fallback es solo defensivo
  // ante un `maxNonceRetries` negativo (input inválido, no debería pasar con
  // el tipo `number` de `RelayDeps`, pero evita un `throw undefined` si pasa).
  throw lastError ?? new Error("writeWithNonceRetry: no se ejecutó ningún intento (maxNonceRetries inválido)");
}

// ---------------------------------------------------------------------------
// Pipeline completo (docs/escrow-interface.md §6)
// ---------------------------------------------------------------------------

export async function handleRelay(body: unknown, deps: RelayDeps): Promise<RelayResponse> {
  // 1. validar el esquema
  const parsed = relayRequestSchema.safeParse(body);
  if (!parsed.success) return invalidRequest();
  const request = parsed.data;

  // 1.5. la dirección del escrow debe ser realmente un contrato (memoizado
  // por proceso) antes de mandar ninguna transacción — ver docs en
  // contractGuard.ts.
  let escrowIsContract: boolean;
  try {
    escrowIsContract = await isContractAddress(deps.publicClient, deps.escrowAddress);
  } catch {
    // un `eth_getCode` caído (cold start, o cuando el `true` todavía no está
    // cacheado) no puede escapar como 500 sin manejar — mismo contrato 502
    // RPC_ERROR que el resto de las llamadas a RPC de este handler (docs/escrow-interface.md §6).
    return rpcError();
  }
  if (!escrowIsContract) return misconfigured();

  // 2. verificar off-chain la firma EIP-712 contra el firmante esperado
  let signatureOk: boolean;
  try {
    signatureOk = await verifySignature(request, deps);
  } catch {
    return rpcError();
  }
  if (!signatureOk) return invalidSignature();

  // 3. simulateContract
  let call: ContractCall;
  try {
    call = buildContractCall(request);
  } catch {
    // p. ej. `parseSignature` sobre un permitSig malformado
    return invalidSignature();
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let simulatedRequest: any;
  try {
    const simulated = await deps.publicClient.simulateContract({
      address: deps.escrowAddress,
      abi: kuskaEscrowAbi,
      account: deps.relayerAccount,
      functionName: call.functionName,
      args: call.args,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    simulatedRequest = simulated.request;
  } catch (err) {
    const reverted = findRevertedError(err);
    if (reverted) {
      const reason = reverted.data?.errorName ?? reverted.reason ?? "UNKNOWN";
      return { status: 409, body: { code: "SIMULATION_REVERTED", reason } };
    }
    return rpcError();
  }

  // 4 + 6. writeContract (con reintento ante error de nonce)
  let hash: Hex;
  try {
    hash = await writeWithNonceRetry(deps, simulatedRequest);
  } catch {
    return rpcError();
  }

  // 5. waitForTransactionReceipt (timeout 20s)
  try {
    const receipt = await deps.publicClient.waitForTransactionReceipt({
      hash,
      timeout: deps.receiptTimeoutMs ?? 20_000,
    });
    if (receipt.status !== "success") {
      // el simulateContract previo pasó, pero la tx minada revirtió igual
      // (p. ej. cambio de estado entre la simulación y la inclusión en bloque)
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
