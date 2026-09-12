import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  encodeErrorResult,
  parseAbi,
  ContractFunctionRevertedError,
  InsufficientFundsError,
  NonceTooLowError,
  RpcRequestError,
  TransactionExecutionError,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { handleRelay, relayRequestSchema, type RelayDeps } from "../server/relay";
import { kuskaEscrowAbi } from "../src/lib/escrow/abi";
import { resetContractGuardCache } from "../server/contractGuard";

const ESCROW_ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const CHAIN_ID = 133;
const ORDER_REF = ("0x" + "aa".repeat(32)) as Hex;
const SIG = ("0x" + "22".repeat(65)) as Hex; // 65 bytes: forma correcta, contenido irrelevante para estos mocks
// permitSig SÍ pasa por `parseSignature` (para separar v/r/s), así que su
// último byte debe ser un valor de v/yParity válido (0x1c = 28).
const PERMIT_SIG = ("0x" + "22".repeat(64) + "1c") as Hex;

const relayerAccount = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);

// ---------------------------------------------------------------------------
// Errores REALES de viem, con la misma forma que `writeContract` tira de
// verdad (`TransactionExecutionError` envolviendo la causa reclasificada por
// `getNodeError` — ver server/viemErrors.ts). Usar estos en vez de
// `new Error("nonce too low")` plano: ese `Error` nunca hubiera pasado por
// `isNonceError` una vez que dejó de matchear sobre `.message` (fix ALTO 1).
// ---------------------------------------------------------------------------

function nonceTooLowError(nonce = 5): TransactionExecutionError {
  return new TransactionExecutionError(new NonceTooLowError({ nonce }), { account: null, nonce });
}

function replacementUnderpricedError(): TransactionExecutionError {
  // viem 2.56.3 no tiene una clase dedicada para este caso del nodo: queda
  // como `RpcRequestError` cruda colgada de `cause` (ver
  // getTransactionError.js: si `getNodeError` no matchea ningún regex,
  // devuelve el error original tal cual, sin reclasificar).
  const rpcError = new RpcRequestError({
    body: { method: "eth_sendRawTransaction" },
    error: { code: -32000, message: "replacement transaction underpriced" },
    url: "https://testnet.hsk.xyz",
  });
  return new TransactionExecutionError(rpcError, { account: null });
}

function insufficientFundsError(): TransactionExecutionError {
  return new TransactionExecutionError(new InsufficientFundsError({}), { account: null });
}

const dealDefaults = {
  buyer: "0x3333333333333333333333333333333333333333" as const,
  amount: 1_000_000n,
  seller: "0x4444444444444444444444444444444444444444" as const,
  deliveryDeadline: 1_893_456_000n,
  claimedAt: 0n,
  state: 1,
};

function createDeps(overrides: Partial<RelayDeps> = {}) {
  const publicClient = {
    verifyTypedData: vi.fn().mockResolvedValue(true),
    readContract: vi.fn().mockResolvedValue(dealDefaults),
    simulateContract: vi.fn().mockResolvedValue({ request: { fake: "request" } }),
    getTransactionCount: vi.fn().mockResolvedValue(1),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({ blockNumber: 42n, status: "success" }),
    // bytecode no vacío por defecto: el escrow "es un contrato" (fix MISCONFIGURED)
    getCode: vi.fn().mockResolvedValue("0x1234"),
  };
  const walletClient = {
    writeContract: vi.fn().mockResolvedValue("0xhash000000000000000000000000000000000000000000000000000000000001"),
    chain: undefined,
  };

  const deps = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    publicClient: publicClient as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    walletClient: walletClient as any,
    relayerAccount,
    escrowAddress: ESCROW_ADDRESS,
    chainId: CHAIN_ID,
    receiptTimeoutMs: 20_000,
    maxNonceRetries: 3,
    ...overrides,
  } satisfies RelayDeps;

  return { deps, publicClient, walletClient };
}

const depositParams = {
  orderRef: ORDER_REF,
  buyer: dealDefaults.buyer,
  seller: dealDefaults.seller,
  amount: "1000000",
  deliveryDeadline: "1893456000",
  authDeadline: "1893456000",
  authSig: SIG,
  permitDeadline: "1893456000",
  permitSig: PERMIT_SIG,
};

describe("handleRelay", () => {
  // el guard de "¿es un contrato?" cachea por dirección en memoria de
  // proceso; resetear entre tests para que cada uno controle su propio mock
  // de `getCode` sin filtrarse al resto.
  beforeEach(() => {
    resetContractGuardCache();
  });

  it("400 INVALID_REQUEST cuando el body no cumple el schema", async () => {
    const { deps, walletClient } = createDeps();
    const result = await handleRelay({ action: "deposit", params: {} }, deps);
    expect(result).toEqual({ status: 400, body: { code: "INVALID_REQUEST" } });
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  it("400 INVALID_REQUEST cuando la acción no existe", async () => {
    const { deps } = createDeps();
    const result = await handleRelay({ action: "teleport", params: {} }, deps);
    expect(result.status).toBe(400);
  });

  it("400 INVALID_SIGNATURE cuando la firma no es del firmante esperado, sin llamar writeContract", async () => {
    const { deps, publicClient, walletClient } = createDeps();
    publicClient.verifyTypedData.mockResolvedValue(false);

    const result = await handleRelay({ action: "deposit", params: depositParams }, deps);

    expect(result).toEqual({ status: 400, body: { code: "INVALID_SIGNATURE" } });
    expect(publicClient.simulateContract).not.toHaveBeenCalled();
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  it("409 SIMULATION_REVERTED con el nombre del custom error, sin llamar writeContract", async () => {
    const { deps, walletClient, publicClient } = createDeps();
    const errorAbi = parseAbi(["error InvalidState(uint8 current)"]);
    const data = encodeErrorResult({ abi: errorAbi, errorName: "InvalidState", args: [1] });
    const reverted = new ContractFunctionRevertedError({
      abi: kuskaEscrowAbi,
      functionName: "cancel",
      data,
    });
    publicClient.simulateContract.mockRejectedValue(reverted);

    const result = await handleRelay(
      {
        action: "cancel",
        params: { orderRef: ORDER_REF, sigDeadline: "1893456000", sellerSig: SIG },
      },
      deps,
    );

    expect(result).toEqual({
      status: 409,
      body: { code: "SIMULATION_REVERTED", reason: "InvalidState" },
    });
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  it("200 con hash y blockNumber en el camino feliz", async () => {
    const { deps } = createDeps();
    const result = await handleRelay({ action: "deposit", params: depositParams }, deps);

    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.status).toBe("success");
      expect(result.body.blockNumber).toBe("42");
      expect(result.body.hash).toMatch(/^0x/);
    }
  });

  it("reintenta hasta con éxito ante un error de nonce en el primer intento", async () => {
    const { deps, walletClient, publicClient } = createDeps();
    walletClient.writeContract
      .mockRejectedValueOnce(nonceTooLowError())
      .mockResolvedValueOnce("0xhash000000000000000000000000000000000000000000000000000000000002");

    const result = await handleRelay({ action: "deposit", params: depositParams }, deps);

    expect(result.status).toBe(200);
    expect(walletClient.writeContract).toHaveBeenCalledTimes(2);
    expect(publicClient.getTransactionCount).toHaveBeenCalledTimes(2);
  });

  it("504 RECEIPT_TIMEOUT con el hash cuando el receipt tarda demasiado", async () => {
    const { deps, publicClient } = createDeps();
    publicClient.waitForTransactionReceipt.mockRejectedValue(new Error("timeout"));

    const result = await handleRelay({ action: "deposit", params: depositParams }, deps);

    expect(result.status).toBe(504);
    if (result.status === 504) {
      expect(result.body.hash).toMatch(/^0x/);
    }
  });

  it("refundExpired no requiere firma (no llama verifyTypedData) y responde 200", async () => {
    const { deps, publicClient } = createDeps();

    const result = await handleRelay(
      { action: "refundExpired", params: { orderRef: ORDER_REF } },
      deps,
    );

    expect(publicClient.verifyTypedData).not.toHaveBeenCalled();
    expect(result.status).toBe(200);
  });

  it("releaseAfterWindow no requiere firma y responde 200", async () => {
    const { deps, publicClient } = createDeps();

    const result = await handleRelay(
      { action: "releaseAfterWindow", params: { orderRef: ORDER_REF } },
      deps,
    );

    expect(publicClient.verifyTypedData).not.toHaveBeenCalled();
    expect(result.status).toBe(200);
  });

  // -- fix TX_REVERTED --------------------------------------------------

  it("409 TX_REVERTED con el hash cuando el receipt indica que la tx revirtió", async () => {
    const { deps, publicClient, walletClient } = createDeps();
    publicClient.waitForTransactionReceipt.mockResolvedValue({
      blockNumber: 42n,
      status: "reverted",
    });

    const result = await handleRelay({ action: "deposit", params: depositParams }, deps);

    expect(result).toEqual({
      status: 409,
      body: { code: "TX_REVERTED", hash: expect.stringMatching(/^0x/) },
    });
    expect(walletClient.writeContract).toHaveBeenCalledTimes(1);
  });

  // -- fix parseSignature fuera de try/catch -----------------------------

  it("400 INVALID_SIGNATURE cuando permitSig no se puede parsear (v/yParity inválido), sin llamar simulateContract", async () => {
    const { deps, publicClient, walletClient } = createDeps();
    // 65 bytes con forma correcta, pero el último byte (v/yParity) no es
    // 0x00/0x01/0x1b/0x1c: `parseSignature` tira "Invalid yParityOrV value".
    const badPermitSig = ("0x" + "22".repeat(64) + "ff") as Hex;

    const result = await handleRelay(
      { action: "deposit", params: { ...depositParams, permitSig: badPermitSig } },
      deps,
    );

    expect(result).toEqual({ status: 400, body: { code: "INVALID_SIGNATURE" } });
    expect(publicClient.simulateContract).not.toHaveBeenCalled();
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  // -- fix reintento de nonce ampliado ------------------------------------

  it("reintenta ante 'replacement transaction underpriced' y responde 200", async () => {
    const { deps, walletClient, publicClient } = createDeps();
    walletClient.writeContract
      .mockRejectedValueOnce(replacementUnderpricedError())
      .mockResolvedValueOnce(
        "0xhash000000000000000000000000000000000000000000000000000000000004",
      );

    const result = await handleRelay({ action: "deposit", params: depositParams }, deps);

    expect(result.status).toBe(200);
    expect(walletClient.writeContract).toHaveBeenCalledTimes(2);
    expect(publicClient.getTransactionCount).toHaveBeenCalledTimes(2);
  });

  // `maxNonceRetries` cuenta REINTENTOS tras el intento inicial (fix BAJO 7):
  // con 2, son hasta 3 llamadas totales a `writeContract` (1 inicial + 2
  // reintentos), no 2.
  it("502 RPC_ERROR tras agotar los reintentos de nonce (tope maxNonceRetries: 3 intentos totales)", async () => {
    const { deps, walletClient } = createDeps({ maxNonceRetries: 2 });
    walletClient.writeContract.mockRejectedValue(nonceTooLowError());

    const result = await handleRelay({ action: "deposit", params: depositParams }, deps);

    expect(result).toEqual({ status: 502, body: { code: "RPC_ERROR" } });
    expect(walletClient.writeContract).toHaveBeenCalledTimes(3);
  });

  it("con maxNonceRetries: 0 se hace exactamente 1 intento (ni 0 ni un `throw undefined`)", async () => {
    const { deps, walletClient } = createDeps({ maxNonceRetries: 0 });
    walletClient.writeContract.mockRejectedValue(nonceTooLowError());

    const result = await handleRelay({ action: "deposit", params: depositParams }, deps);

    expect(result).toEqual({ status: 502, body: { code: "RPC_ERROR" } });
    expect(walletClient.writeContract).toHaveBeenCalledTimes(1);
  });

  // -- fix ALTO 1: NO reintentar (ni pagar el gas dos veces) ante un error
  // de write que no es de nonce ------------------------------------------

  it("NO reintenta ante 'insufficient funds': writeContract se llama exactamente 1 vez y responde 502", async () => {
    const { deps, walletClient, publicClient } = createDeps();
    walletClient.writeContract.mockRejectedValue(insufficientFundsError());

    const result = await handleRelay({ action: "deposit", params: depositParams }, deps);

    expect(result).toEqual({ status: 502, body: { code: "RPC_ERROR" } });
    expect(walletClient.writeContract).toHaveBeenCalledTimes(1);
    expect(publicClient.getTransactionCount).toHaveBeenCalledTimes(1);
  });

  // -- fix getCode -> 503 MISCONFIGURED -----------------------------------

  it("503 MISCONFIGURED cuando el escrow no tiene bytecode, sin llamar verifyTypedData/simulateContract/writeContract", async () => {
    const { deps, publicClient, walletClient } = createDeps();
    publicClient.getCode.mockResolvedValue("0x");

    const result = await handleRelay({ action: "deposit", params: depositParams }, deps);

    expect(result).toEqual({ status: 503, body: { code: "MISCONFIGURED" } });
    expect(publicClient.verifyTypedData).not.toHaveBeenCalled();
    expect(publicClient.simulateContract).not.toHaveBeenCalled();
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  it("cachea el resultado de getCode en memoria: solo golpea el RPC una vez por dirección", async () => {
    const { deps, publicClient } = createDeps();

    await handleRelay({ action: "refundExpired", params: { orderRef: ORDER_REF } }, deps);
    await handleRelay({ action: "refundExpired", params: { orderRef: ORDER_REF } }, deps);

    expect(publicClient.getCode).toHaveBeenCalledTimes(1);
  });

  // -- fix caché asimétrica: NO cachear `false` ---------------------------

  it("NO cachea un `false`: un getCode que devuelve '0x' se reconsulta en la próxima llamada, y si luego hay bytecode la request pasa", async () => {
    const { deps, publicClient, walletClient } = createDeps();
    publicClient.getCode.mockResolvedValueOnce("0x").mockResolvedValueOnce("0x1234");

    const first = await handleRelay(
      { action: "refundExpired", params: { orderRef: ORDER_REF } },
      deps,
    );
    expect(first).toEqual({ status: 503, body: { code: "MISCONFIGURED" } });

    const second = await handleRelay(
      { action: "refundExpired", params: { orderRef: ORDER_REF } },
      deps,
    );

    expect(publicClient.getCode).toHaveBeenCalledTimes(2);
    expect(second.status).toBe(200);
    expect(walletClient.writeContract).toHaveBeenCalledTimes(1);
  });
});

describe("relayRequestSchema — validación de firmas (fix ERC-1271)", () => {
  const baseCancelParams = { orderRef: ORDER_REF, sigDeadline: "1893456000" };

  it("acepta una firma de longitud par arbitraria (ERC-1271, smart account) en sellerSig", () => {
    const erc1271Sig = "0x" + "ab".repeat(96); // 96 bytes / 192 hex, par
    const result = relayRequestSchema.safeParse({
      action: "cancel",
      params: { ...baseCancelParams, sellerSig: erc1271Sig },
    });
    expect(result.success).toBe(true);
  });

  it("rechaza una firma de longitud hex impar (129 hex — bug histórico)", () => {
    const oddLengthSig = "0x" + "ab".repeat(64) + "a"; // 129 hex, impar
    const result = relayRequestSchema.safeParse({
      action: "cancel",
      params: { ...baseCancelParams, sellerSig: oddLengthSig },
    });
    expect(result.success).toBe(false);
  });

  it("rechaza una firma demasiado corta (<64 hex)", () => {
    const tooShortSig = "0x" + "ab".repeat(16); // 32 hex
    const result = relayRequestSchema.safeParse({
      action: "cancel",
      params: { ...baseCancelParams, sellerSig: tooShortSig },
    });
    expect(result.success).toBe(false);
  });

  it("rechaza una firma demasiado larga (>8192 hex)", () => {
    const tooLongSig = "0x" + "ab".repeat(4097); // 8194 hex
    const result = relayRequestSchema.safeParse({
      action: "cancel",
      params: { ...baseCancelParams, sellerSig: tooLongSig },
    });
    expect(result.success).toBe(false);
  });

  it("permitSig sigue exigiendo exactamente 65 bytes (130 hex), incluso con la firma flexible ya aplicada a las demás", () => {
    const shortPermit = "0x" + "22".repeat(64); // 64 bytes: ya no alcanza para permitSig
    const result = relayRequestSchema.safeParse({
      action: "deposit",
      params: { ...depositParams, permitSig: shortPermit },
    });
    expect(result.success).toBe(false);
  });
});
