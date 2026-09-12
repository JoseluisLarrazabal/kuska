import { z } from "zod";
import type { Account, Address, Hex, PublicClient, WalletClient } from "viem";
import { mockUsdAbi } from "../src/lib/escrow/abi";
import { findRevertedError } from "./viemErrors";
import { isContractAddress } from "./contractGuard";

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
  /** default 20_000 ms (docs §6) */
  receiptTimeoutMs?: number;
}

export type FaucetResponse =
  | { status: 200; body: { hash: Hex; blockNumber: string; status: "success" } }
  | { status: 400; body: { code: "INVALID_REQUEST" } }
  | { status: 404; body: { code: "NOT_FOUND" } }
  | { status: 409; body: { code: "FAUCET_COOLDOWN"; availableAt: string } }
  | { status: 409; body: { code: "TX_REVERTED"; hash: Hex } }
  | { status: 502; body: { code: "RPC_ERROR" } }
  | { status: 503; body: { code: "MISCONFIGURED" } }
  | { status: 504; body: { code: "RECEIPT_TIMEOUT"; hash: Hex } };

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

  // la dirección del token debe ser realmente un contrato (memoizado por
  // proceso) antes de mandar ninguna transacción — ver contractGuard.ts. El
  // relayer ya mandó una tx de faucet a una dirección sin contrato en testnet.
  const tokenIsContract = await isContractAddress(deps.publicClient, deps.tokenAddress);
  if (!tokenIsContract) {
    return { status: 503, body: { code: "MISCONFIGURED" } };
  }

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

  let hash: Hex;
  try {
    hash = await deps.walletClient.writeContract({
      ...simulatedRequest,
      account: deps.relayerAccount,
      chain: deps.walletClient.chain,
    });
  } catch {
    return { status: 502, body: { code: "RPC_ERROR" } };
  }

  // esperar el receipt: una tx que revierte on-chain (tras pasar la
  // simulación) no puede reportarse como éxito — ver docs/escrow-interface.md §6.
  try {
    const receipt = await deps.publicClient.waitForTransactionReceipt({
      hash,
      timeout: deps.receiptTimeoutMs ?? 20_000,
    });
    if (receipt.status !== "success") {
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
