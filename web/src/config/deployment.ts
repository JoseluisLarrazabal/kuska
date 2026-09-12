import { z } from "zod";
import type { Chain } from "viem";
import { hashkey, hashkeyTestnet } from "viem/chains";

const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "dirección inválida (esperado 0x + 40 hex)");

const chainIdSchema = z
  .string()
  .regex(/^\d+$/, "VITE_CHAIN_ID debe ser numérico")
  .transform(Number)
  .pipe(z.union([z.literal(133), z.literal(177)]));

const clientEnvSchema = z.object({
  VITE_CHAIN_ID: chainIdSchema,
  VITE_ESCROW_ADDRESS: addressSchema,
  VITE_TOKEN_ADDRESS: addressSchema,
  VITE_DEPLOY_BLOCK: z
    .string()
    .regex(/^\d+$/, "VITE_DEPLOY_BLOCK debe ser numérico")
    .transform((v) => BigInt(v)),
  VITE_DEMO_SELLER: addressSchema,
});

export interface DeploymentConfig {
  chainId: 133 | 177;
  chain: Chain;
  escrowAddress: `0x${string}`;
  tokenAddress: `0x${string}`;
  deployBlock: bigint;
  demoSeller: `0x${string}`;
}

function chainForId(chainId: 133 | 177): Chain {
  return chainId === 133 ? hashkeyTestnet : hashkey;
}

let cached: DeploymentConfig | undefined;

/**
 * Lee y valida la configuración de deployment desde las variables de entorno
 * de Vite (VITE_*). En este worktree no existe `contracts/deployments/<chainId>.json`
 * (lo genera el carril de contratos), así que las direcciones se leen por env.
 */
export function getDeploymentConfig(): DeploymentConfig {
  if (cached) return cached;

  const parsed = clientEnvSchema.safeParse(import.meta.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(
      `Configuración de deployment inválida o incompleta (revisá web/.env.local contra .env.example): ${issues}`,
    );
  }

  const data = parsed.data;
  cached = {
    chainId: data.VITE_CHAIN_ID,
    chain: chainForId(data.VITE_CHAIN_ID),
    escrowAddress: data.VITE_ESCROW_ADDRESS as `0x${string}`,
    tokenAddress: data.VITE_TOKEN_ADDRESS as `0x${string}`,
    deployBlock: data.VITE_DEPLOY_BLOCK,
    demoSeller: data.VITE_DEMO_SELLER as `0x${string}`,
  };
  return cached;
}
