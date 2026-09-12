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
  /**
   * `true` solo cuando `getBalance` del relayer falló (RPC caído): `/api/health`
   * es justo el endpoint que existe para diagnosticar un RPC caído, así que
   * degrada en vez de crashear con un 500 sin cuerpo (docs/escrow-interface.md
   * §6). El resto del body sigue siendo válido; `relayerBalanceWei` queda en
   * `"0"` y `lowBalance` en `true` (conservador: no se pudo verificar el saldo
   * real, así que no se puede afirmar que NO está bajo). Ausente (no `false`)
   * en el camino feliz, para no ensuciar el shape documentado.
   */
  relayerBalanceError?: boolean;
}

/** `lowBalance` = saldo < 0.02 HSK (docs/escrow-interface.md §6). */
const LOW_BALANCE_THRESHOLD_WEI = 20_000_000_000_000_000n;

/** `GET /api/health` (docs/escrow-interface.md §6). */
export async function handleHealth(deps: HealthDeps): Promise<HealthResponse> {
  let balance: bigint;
  let relayerBalanceError = false;
  try {
    balance = await deps.publicClient.getBalance({ address: deps.relayerAccount.address });
  } catch {
    // un RPC caído acá no puede escapar como un 500 sin cuerpo — justo este
    // endpoint es el que se usa para diagnosticar el incidente (ver docblock
    // de `relayerBalanceError`). Degradar, no crashear.
    balance = 0n;
    relayerBalanceError = true;
  }

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
    lowBalance: relayerBalanceError ? true : balance < LOW_BALANCE_THRESHOLD_WEI,
    tokenMatchesEscrow,
    ...(relayerBalanceError ? { relayerBalanceError: true as const } : {}),
  };
}
