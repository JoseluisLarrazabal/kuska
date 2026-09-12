import { describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { handleHealth, type HealthDeps } from "../server/health";

const ESCROW_ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const TOKEN_ADDRESS = "0x2222222222222222222222222222222222222222" as const;

const relayerAccount = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);

function createDeps(overrides: Partial<HealthDeps> = {}) {
  const publicClient = {
    getBalance: vi.fn().mockResolvedValue(100_000_000_000_000_000n), // 0.1 HSK
    readContract: vi.fn().mockResolvedValue(TOKEN_ADDRESS),
  };

  const deps = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    publicClient: publicClient as any,
    relayerAccount,
    escrowAddress: ESCROW_ADDRESS,
    tokenAddress: TOKEN_ADDRESS,
    chainId: 133,
    ...overrides,
  } satisfies HealthDeps;

  return { deps, publicClient };
}

describe("handleHealth", () => {
  it("lowBalance es false por encima del umbral (0.02 HSK)", async () => {
    const { deps } = createDeps();

    const result = await handleHealth(deps);

    expect(result.lowBalance).toBe(false);
  });

  it("lowBalance es true por debajo del umbral (0.02 HSK)", async () => {
    const { deps, publicClient } = createDeps();
    publicClient.getBalance.mockResolvedValue(1_000_000_000_000_000n); // 0.001 HSK

    const result = await handleHealth(deps);

    expect(result.lowBalance).toBe(true);
  });

  // -- fix BAJO 11: reconciliar TOKEN_ADDRESS con escrow.token() -----------

  it("tokenMatchesEscrow es true cuando escrow.token() coincide con TOKEN_ADDRESS", async () => {
    const { deps, publicClient } = createDeps();
    publicClient.readContract.mockResolvedValue(TOKEN_ADDRESS);

    const result = await handleHealth(deps);

    expect(result.tokenMatchesEscrow).toBe(true);
  });

  it("tokenMatchesEscrow es false cuando escrow.token() NO coincide con TOKEN_ADDRESS (env var mal configurada)", async () => {
    const { deps, publicClient } = createDeps();
    publicClient.readContract.mockResolvedValue(
      "0x9999999999999999999999999999999999999999",
    );

    const result = await handleHealth(deps);

    expect(result.tokenMatchesEscrow).toBe(false);
  });

  it("tokenMatchesEscrow es false (nunca revienta) cuando escrow.token() revierte (p. ej. escrow sin desplegar)", async () => {
    const { deps, publicClient } = createDeps();
    publicClient.readContract.mockRejectedValue(new Error("execution reverted"));

    const result = await handleHealth(deps);

    expect(result.tokenMatchesEscrow).toBe(false);
  });

  // -- fix MEDIO 3: getBalance sin try/catch --------------------------------

  it("degrada (no revienta) cuando getBalance del relayer rechaza: reporta la dependencia caída en el body", async () => {
    const { deps, publicClient } = createDeps();
    publicClient.getBalance.mockRejectedValue(new Error("rpc caído"));

    const result = await handleHealth(deps);

    expect(result.relayerBalanceError).toBe(true);
    expect(result.relayerBalanceWei).toBe("0");
    expect(result.lowBalance).toBe(true);
    // el resto del body sigue siendo válido: no un 500 sin cuerpo.
    expect(result.chainId).toBe(133);
    expect(result.relayer).toBe(relayerAccount.address);
  });

  it("relayerBalanceError está ausente (no `false`) en el camino feliz", async () => {
    const { deps } = createDeps();

    const result = await handleHealth(deps);

    expect(result.relayerBalanceError).toBeUndefined();
  });
});
