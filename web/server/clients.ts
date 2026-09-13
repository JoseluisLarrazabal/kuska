import { createPublicClient, createWalletClient, http, type PublicClient, type WalletClient } from "viem";
import { getServerConfig } from "./config.js";

export interface RelayerClients {
  publicClient: PublicClient;
  walletClient: WalletClient;
}

let cached: RelayerClients | undefined;

/** Clientes viem del relayer, construidos una sola vez a partir del config del servidor. */
export function getRelayerClients(): RelayerClients {
  if (cached) return cached;

  const config = getServerConfig();
  const transport = http(config.rpcUrl);

  const publicClient = createPublicClient({ chain: config.chain, transport });
  const walletClient = createWalletClient({
    chain: config.chain,
    transport,
    account: config.relayerAccount,
  });

  cached = { publicClient, walletClient };
  return cached;
}
