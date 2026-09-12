import { z } from "zod";
import type { Chain } from "viem";
import { hashkey, hashkeyTestnet } from "viem/chains";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "dirección inválida (esperado 0x + 40 hex)");

const chainIdSchema = z
  .string()
  .regex(/^\d+$/, "CHAIN_ID debe ser numérico")
  .transform(Number)
  .pipe(z.union([z.literal(133), z.literal(177)]));

const privateKeySchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "RELAYER_PRIVATE_KEY inválida (esperado 0x + 64 hex)");

const serverEnvSchema = z.object({
  CHAIN_ID: chainIdSchema,
  RPC_URL: z.string().url("RPC_URL debe ser una URL válida"),
  ESCROW_ADDRESS: addressSchema,
  TOKEN_ADDRESS: addressSchema,
  RELAYER_PRIVATE_KEY: privateKeySchema,
});

export interface ServerConfig {
  chainId: 133 | 177;
  chain: Chain;
  rpcUrl: string;
  escrowAddress: `0x${string}`;
  tokenAddress: `0x${string}`;
  relayerAccount: PrivateKeyAccount;
}

function chainForId(chainId: 133 | 177): Chain {
  return chainId === 133 ? hashkeyTestnet : hashkey;
}

let cached: ServerConfig | undefined;

/**
 * Lee y valida la configuración del relayer desde variables de entorno del
 * servidor. `RELAYER_PRIVATE_KEY` nunca se expone ni se loguea: solo se usa
 * para derivar la cuenta viem en memoria.
 */
export function getServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  if (cached) return cached;

  const parsed = serverEnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(
      `Configuración del servidor inválida o incompleta (revisá las env vars contra web/.env.example): ${issues}`,
    );
  }

  const data = parsed.data;
  cached = {
    chainId: data.CHAIN_ID,
    chain: chainForId(data.CHAIN_ID),
    rpcUrl: data.RPC_URL,
    escrowAddress: data.ESCROW_ADDRESS as `0x${string}`,
    tokenAddress: data.TOKEN_ADDRESS as `0x${string}`,
    relayerAccount: privateKeyToAccount(data.RELAYER_PRIVATE_KEY as `0x${string}`),
  };
  return cached;
}

/** Solo para tests: limpia el config cacheado. */
export function resetServerConfigCache(): void {
  cached = undefined;
}
