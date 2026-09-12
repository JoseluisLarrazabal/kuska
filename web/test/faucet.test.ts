import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContractFunctionRevertedError, encodeErrorResult, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  handleFaucet,
  resetFaucetRateLimiter,
  getFaucetRateLimiterSize,
  type FaucetDeps,
} from "../server/faucet";
import { resetContractGuardCache } from "../server/contractGuard";
import { mockUsdAbi } from "../src/lib/escrow/abi";

const TOKEN_ADDRESS = "0x2222222222222222222222222222222222222222" as const;
const TEST_IP = "203.0.113.1";
const HEALTHY_RELAYER_BALANCE_WEI = 100_000_000_000_000_000n; // 0.1 HSK

const relayerAccount = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);

function createDeps(overrides: Partial<FaucetDeps> = {}) {
  const publicClient = {
    simulateContract: vi.fn().mockResolvedValue({ request: { fake: "request" } }),
    // bytecode no vacío por defecto: el token "es un contrato" (fix MISCONFIGURED)
    getCode: vi.fn().mockResolvedValue("0x1234"),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({ blockNumber: 7n, status: "success" }),
    // saldo del relayer por encima del piso por defecto (fix RELAYER_LOW_BALANCE)
    getBalance: vi.fn().mockResolvedValue(HEALTHY_RELAYER_BALANCE_WEI),
  };
  const walletClient = {
    writeContract: vi.fn().mockResolvedValue("0xhash000000000000000000000000000000000000000000000000000000000003"),
    chain: undefined,
  };

  const deps = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    publicClient: publicClient as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    walletClient: walletClient as any,
    relayerAccount,
    tokenAddress: TOKEN_ADDRESS,
    chainId: 133,
    receiptTimeoutMs: 20_000,
    ...overrides,
  } satisfies FaucetDeps;

  return { deps, publicClient, walletClient };
}

describe("handleFaucet", () => {
  beforeEach(() => {
    resetContractGuardCache();
    resetFaucetRateLimiter();
  });

  it("404 en mainnet (chainId 177), sin llamar simulateContract", async () => {
    const { deps, publicClient } = createDeps({ chainId: 177 });

    const result = await handleFaucet(
      { to: "0x3333333333333333333333333333333333333333" },
      deps,
      TEST_IP,
    );

    expect(result).toEqual({ status: 404, body: { code: "NOT_FOUND" } });
    expect(publicClient.simulateContract).not.toHaveBeenCalled();
  });

  it("200 con hash y blockNumber en testnet (chainId 133)", async () => {
    const { deps } = createDeps();

    const result = await handleFaucet(
      { to: "0x3333333333333333333333333333333333333333" },
      deps,
      TEST_IP,
    );

    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.hash).toMatch(/^0x/);
      expect(result.body.status).toBe("success");
      expect(result.body.blockNumber).toBe("7");
    }
  });

  it("400 INVALID_REQUEST cuando `to` no es una dirección válida", async () => {
    const { deps } = createDeps();

    const result = await handleFaucet({ to: "no-es-una-direccion" }, deps, TEST_IP);

    expect(result).toEqual({ status: 400, body: { code: "INVALID_REQUEST" } });
  });

  it("503 MISCONFIGURED cuando el token no tiene bytecode, sin llamar simulateContract/writeContract", async () => {
    const { deps, publicClient, walletClient } = createDeps();
    publicClient.getCode.mockResolvedValue("0x");

    const result = await handleFaucet(
      { to: "0x3333333333333333333333333333333333333333" },
      deps,
      TEST_IP,
    );

    expect(result).toEqual({ status: 503, body: { code: "MISCONFIGURED" } });
    expect(publicClient.simulateContract).not.toHaveBeenCalled();
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  // -- fix TX_REVERTED / RECEIPT_TIMEOUT (esperar el receipt) -------------

  it("409 TX_REVERTED con el hash cuando el receipt indica que la tx revirtió", async () => {
    const { deps, publicClient, walletClient } = createDeps();
    publicClient.waitForTransactionReceipt.mockResolvedValue({
      blockNumber: 7n,
      status: "reverted",
    });

    const result = await handleFaucet(
      { to: "0x3333333333333333333333333333333333333333" },
      deps,
      TEST_IP,
    );

    expect(result).toEqual({
      status: 409,
      body: { code: "TX_REVERTED", hash: expect.stringMatching(/^0x/) },
    });
    expect(walletClient.writeContract).toHaveBeenCalledTimes(1);
  });

  it("504 RECEIPT_TIMEOUT con el hash cuando el receipt tarda demasiado", async () => {
    const { deps, publicClient } = createDeps();
    publicClient.waitForTransactionReceipt.mockRejectedValue(new Error("timeout"));

    const result = await handleFaucet(
      { to: "0x3333333333333333333333333333333333333333" },
      deps,
      TEST_IP,
    );

    expect(result.status).toBe(504);
    if (result.status === 504) {
      expect(result.body.hash).toMatch(/^0x/);
    }
  });

  // -- fix ALTO 3: piso de saldo del relayer -------------------------------

  it("503 RELAYER_LOW_BALANCE cuando el saldo del relayer está bajo el piso, sin llamar simulateContract/writeContract", async () => {
    const { deps, publicClient, walletClient } = createDeps({
      minRelayerBalanceWei: 20_000_000_000_000_000n,
    });
    publicClient.getBalance.mockResolvedValue(1_000_000_000_000_000n); // 0.001 HSK

    const result = await handleFaucet(
      { to: "0x3333333333333333333333333333333333333333" },
      deps,
      TEST_IP,
    );

    expect(result).toEqual({ status: 503, body: { code: "RELAYER_LOW_BALANCE" } });
    expect(publicClient.simulateContract).not.toHaveBeenCalled();
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  it("502 RPC_ERROR cuando getBalance (piso de saldo del relayer) rechaza, sin llamar simulateContract/writeContract", async () => {
    const { deps, publicClient, walletClient } = createDeps();
    publicClient.getBalance.mockRejectedValue(new Error("rpc caído"));

    const result = await handleFaucet(
      { to: "0x3333333333333333333333333333333333333333" },
      deps,
      TEST_IP,
    );

    expect(result).toEqual({ status: 502, body: { code: "RPC_ERROR" } });
    expect(publicClient.simulateContract).not.toHaveBeenCalled();
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  // -- fix ALTO 3: rate limit por IP ---------------------------------------

  it("429 RATE_LIMITED después de 3 pedidos de la misma IP en la ventana, sin llamar simulateContract", async () => {
    const { deps, publicClient } = createDeps();
    const to = "0x3333333333333333333333333333333333333333";

    for (let i = 0; i < 3; i++) {
      const ok = await handleFaucet({ to }, deps, TEST_IP);
      expect(ok.status).toBe(200);
    }

    publicClient.simulateContract.mockClear();
    const result = await handleFaucet({ to }, deps, TEST_IP);

    expect(result).toEqual({
      status: 429,
      body: { code: "RATE_LIMITED", retryAfter: expect.any(Number) },
    });
    expect(publicClient.simulateContract).not.toHaveBeenCalled();
  });

  it("el rate limit es por IP: una IP distinta no se ve afectada por el límite de otra", async () => {
    const { deps } = createDeps();
    const to = "0x3333333333333333333333333333333333333333";

    for (let i = 0; i < 3; i++) {
      await handleFaucet({ to }, deps, TEST_IP);
    }
    const limited = await handleFaucet({ to }, deps, TEST_IP);
    expect(limited.status).toBe(429);

    const otherIpResult = await handleFaucet({ to }, deps, "198.51.100.7");
    expect(otherIpResult.status).toBe(200);
  });

  it("el rate limiter no acumula memoria indefinidamente: las entradas expiradas se eliminan del Map", async () => {
    vi.useFakeTimers();
    try {
      const { deps } = createDeps();
      const to = "0x3333333333333333333333333333333333333333";

      await handleFaucet({ to }, deps, TEST_IP);
      expect(getFaucetRateLimiterSize()).toBe(1);

      // avanzar más allá de la ventana de rate limit (10 minutos): la
      // entrada de TEST_IP queda completamente expirada.
      vi.advanceTimersByTime(11 * 60 * 1000);

      // cualquier pedido posterior dispara el barrido de entradas expiradas
      // (evictStaleRateLimitEntries) — no hace falta que sea la misma IP.
      await handleFaucet({ to }, deps, "198.51.100.9");

      // sólo debería quedar la entrada de la IP nueva: la de TEST_IP, ya
      // expirada, se evictó en vez de quedar colgada en memoria.
      expect(getFaucetRateLimiterSize()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // -- fix BAJO 8: mapeo de errores de simulación más preciso --------------

  it("409 SIMULATION_REVERTED con el nombre del custom error para un revert que NO es FaucetCooldown", async () => {
    const { deps, publicClient, walletClient } = createDeps();
    // OJO: el abi usado para codificar `data` debe ser (un superset de) el
    // MISMO abi que la producción pasa a `simulateContract` (`mockUsdAbi`):
    // viem sólo puede decodificar el `errorName` de un revert si el error
    // está declarado en ese abi. `ERC2612ExpiredSignature` es un custom error
    // real de OZ v5 `ERC20Permit` (que `MockUSD` extiende, ver abi.ts) — no
    // uno inventado como "EnforcedPause", que no existe en `mockUsdAbi` (y
    // `MockUSD` no tiene pausa, docs/escrow-interface.md §2) y por eso nunca
    // sería decodificable, sin importar qué tan bien clasifique el código.
    const errorAbi = parseAbi(["error ERC2612ExpiredSignature(uint256 deadline)"]);
    const data = encodeErrorResult({
      abi: errorAbi,
      errorName: "ERC2612ExpiredSignature",
      args: [1893456000n],
    });
    const reverted = new ContractFunctionRevertedError({
      abi: mockUsdAbi,
      functionName: "faucet",
      data,
    });
    publicClient.simulateContract.mockRejectedValue(reverted);

    const result = await handleFaucet(
      { to: "0x3333333333333333333333333333333333333333" },
      deps,
      TEST_IP,
    );

    expect(result).toEqual({
      status: 409,
      body: { code: "SIMULATION_REVERTED", reason: "ERC2612ExpiredSignature" },
    });
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });
});
