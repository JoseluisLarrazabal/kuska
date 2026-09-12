import { describe, expect, it, vi } from "vitest";
import { encodeErrorResult, parseAbi, ContractFunctionRevertedError, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { handleRelay, type RelayDeps } from "../server/relay";
import { kuskaEscrowAbi } from "../src/lib/escrow/abi";

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
      .mockRejectedValueOnce(new Error("nonce too low"))
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
});
