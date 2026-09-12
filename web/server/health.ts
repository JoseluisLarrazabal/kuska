import { isAddressEqual, type Account, type Address, type PublicClient } from "viem";
import { kuskaEscrowAbi } from "../src/lib/escrow/abi";

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
  /**
   * `false` si no se pudo determinar (p. ej. `escrowAddress` no es un
   * contrato desplegado todavía, o `escrow.token()` revierte/no existe).
   * `true` solo cuando se leyó `escrow.token()` on-chain y coincide con
   * `TOKEN_ADDRESS`. Un mismatch real es una env var mal configurada: el
   * faucet mintearía un token que el escrow no acepta, y el depósito
   * fallaría recién en `safeTransferFrom`.
   */
  tokenMatchesEscrow: boolean;
}

/** `lowBalance` = saldo < 0.02 HSK (docs/escrow-interface.md §6). */
const LOW_BALANCE_THRESHOLD_WEI = 20_000_000_000_000_000n;

/** `GET /api/health` (docs/escrow-interface.md §6). */
export async function handleHealth(deps: HealthDeps): Promise<HealthResponse> {
  const balance = await deps.publicClient.getBalance({ address: deps.relayerAccount.address });

  let tokenMatchesEscrow = false;
  try {
    const escrowToken = await deps.publicClient.readContract({
      address: deps.escrowAddress,
      abi: kuskaEscrowAbi,
      functionName: "token",
    });
    tokenMatchesEscrow = isAddressEqual(escrowToken, deps.tokenAddress);
  } catch {
    // `escrowAddress` sin bytecode desplegado todavía, RPC caído, etc.: no
    // podemos afirmar que coincide, así que queda en `false` (ver docblock).
  }

  return {
    chainId: deps.chainId,
    relayer: deps.relayerAccount.address,
    relayerBalanceWei: balance.toString(),
    escrow: deps.escrowAddress,
    token: deps.tokenAddress,
    lowBalance: balance < LOW_BALANCE_THRESHOLD_WEI,
    tokenMatchesEscrow,
  };
}
