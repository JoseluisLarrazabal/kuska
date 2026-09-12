import type { Account, Address, PublicClient } from "viem";

export interface HealthDeps {
  publicClient: PublicClient;
  relayerAccount: Account;
  escrowAddress: Address;
  tokenAddress: Address;
  chainId: number;
}

export interface HealthResponse {
  chainId: number;
  relayer: Address;
  relayerBalanceWei: string;
  escrow: Address;
  token: Address;
  lowBalance: boolean;
}

/** `lowBalance` = saldo < 0.02 HSK (docs/escrow-interface.md §6). */
const LOW_BALANCE_THRESHOLD_WEI = 20_000_000_000_000_000n;

/** `GET /api/health` (docs/escrow-interface.md §6). */
export async function handleHealth(deps: HealthDeps): Promise<HealthResponse> {
  const balance = await deps.publicClient.getBalance({ address: deps.relayerAccount.address });
  return {
    chainId: deps.chainId,
    relayer: deps.relayerAccount.address,
    relayerBalanceWei: balance.toString(),
    escrow: deps.escrowAddress,
    token: deps.tokenAddress,
    lowBalance: balance < LOW_BALANCE_THRESHOLD_WEI,
  };
}
