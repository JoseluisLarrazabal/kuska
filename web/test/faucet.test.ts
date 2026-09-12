import { beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { handleFaucet, type FaucetDeps } from "../server/faucet";
import { resetContractGuardCache } from "../server/contractGuard";

const TOKEN_ADDRESS = "0x2222222222222222222222222222222222222222" as const;

const relayerAccount = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);

function createDeps(overrides: Partial<FaucetDeps> = {}) {
  const publicClient = {
    simulateContract: vi.fn().mockResolvedValue({ request: { fake: "request" } }),
    // bytecode no vacío por defecto: el token "es un contrato" (fix MISCONFIGURED)
    getCode: vi.fn().mockResolvedValue("0x1234"),
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
    ...overrides,
  } satisfies FaucetDeps;

  return { deps, publicClient, walletClient };
}

describe("handleFaucet", () => {
  beforeEach(() => {
    resetContractGuardCache();
  });

  it("404 en mainnet (chainId 177), sin llamar simulateContract", async () => {
    const { deps, publicClient } = createDeps({ chainId: 177 });

    const result = await handleFaucet({ to: "0x3333333333333333333333333333333333333333" }, deps);

    expect(result).toEqual({ status: 404, body: { code: "NOT_FOUND" } });
    expect(publicClient.simulateContract).not.toHaveBeenCalled();
  });

  it("200 con hash en testnet (chainId 133)", async () => {
    const { deps } = createDeps();

    const result = await handleFaucet({ to: "0x3333333333333333333333333333333333333333" }, deps);

    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.hash).toMatch(/^0x/);
    }
  });

  it("400 INVALID_REQUEST cuando `to` no es una dirección válida", async () => {
    const { deps } = createDeps();

    const result = await handleFaucet({ to: "no-es-una-direccion" }, deps);

    expect(result).toEqual({ status: 400, body: { code: "INVALID_REQUEST" } });
  });

  it("503 MISCONFIGURED cuando el token no tiene bytecode, sin llamar simulateContract/writeContract", async () => {
    const { deps, publicClient, walletClient } = createDeps();
    publicClient.getCode.mockResolvedValue("0x");

    const result = await handleFaucet(
      { to: "0x3333333333333333333333333333333333333333" },
      deps,
    );

    expect(result).toEqual({ status: 503, body: { code: "MISCONFIGURED" } });
    expect(publicClient.simulateContract).not.toHaveBeenCalled();
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });
});
