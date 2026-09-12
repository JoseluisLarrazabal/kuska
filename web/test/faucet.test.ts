import { describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { handleFaucet, type FaucetDeps } from "../server/faucet";

const TOKEN_ADDRESS = "0x2222222222222222222222222222222222222222" as const;

const relayerAccount = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);

function createDeps(overrides: Partial<FaucetDeps> = {}) {
  const publicClient = {
    simulateContract: vi.fn().mockResolvedValue({ request: { fake: "request" } }),
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
});
