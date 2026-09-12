import { createPublicClient, http, type PublicClient } from "viem";
import { getDeploymentConfig } from "../../config/deployment";

let cached: PublicClient | undefined;

/** Cliente de lectura viem (RPC público de la red configurada). Singleton. */
export function getPublicClient(): PublicClient {
  if (cached) return cached;
  const { chain } = getDeploymentConfig();
  cached = createPublicClient({ chain, transport: http() });
  return cached;
}
