import { z } from "zod";
import type { Account, Address, Hex, PublicClient, WalletClient } from "viem";
import { mockUsdAbi } from "../src/lib/escrow/abi";
import { findRevertedError } from "./viemErrors";

const faucetRequestSchema = z.object({
  to: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "dirección inválida"),
});

export interface FaucetDeps {
  publicClient: PublicClient;
  walletClient: WalletClient;
  relayerAccount: Account;
  tokenAddress: Address;
  /** en mainnet (177) el faucet no existe: 404 */
  chainId: number;
}

export type FaucetResponse =
  | { status: 200; body: { hash: Hex } }
  | { status: 400; body: { code: "INVALID_REQUEST" } }
  | { status: 404; body: { code: "NOT_FOUND" } }
  | { status: 409; body: { code: "FAUCET_COOLDOWN"; availableAt: string } }
  | { status: 502; body: { code: "RPC_ERROR" } };

/** `POST /api/faucet` (docs/escrow-interface.md §6). */
export async function handleFaucet(body: unknown, deps: FaucetDeps): Promise<FaucetResponse> {
  if (deps.chainId === 177) {
    return { status: 404, body: { code: "NOT_FOUND" } };
  }

  const parsed = faucetRequestSchema.safeParse(body);
  if (!parsed.success) {
    return { status: 400, body: { code: "INVALID_REQUEST" } };
  }
  const to = parsed.data.to as Address;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let simulatedRequest: any;
  try {
    const simulated = await deps.publicClient.simulateContract({
      address: deps.tokenAddress,
      abi: mockUsdAbi,
      account: deps.relayerAccount,
      functionName: "faucet",
      args: [to],
    });
    simulatedRequest = simulated.request;
  } catch (err) {
    const reverted = findRevertedError(err);
    if (reverted?.data?.errorName === "FaucetCooldown") {
      const availableAt = reverted.data.args?.[0];
      return {
        status: 409,
        body: { code: "FAUCET_COOLDOWN", availableAt: String(availableAt ?? "0") },
      };
    }
    return { status: 502, body: { code: "RPC_ERROR" } };
  }

  try {
    const hash = await deps.walletClient.writeContract({
      ...simulatedRequest,
      account: deps.relayerAccount,
      chain: deps.walletClient.chain,
    });
    return { status: 200, body: { hash } };
  } catch {
    return { status: 502, body: { code: "RPC_ERROR" } };
  }
}
