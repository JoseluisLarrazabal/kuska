import { getServerConfig } from "../server/config.js";
import { getRelayerClients } from "../server/clients.js";
import { getClientIp } from "../server/clientIp.js";
import { handleFaucet, type FaucetDeps } from "../server/faucet.js";

export const config = {
  maxDuration: 30,
};

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ code: "INVALID_REQUEST" }, { status: 405 });
  }

  // `getServerConfig`/`getRelayerClients` tiran un `Error` pelado si falta o
  // es inválida una env var del servidor. Sin este try/catch, en Vercel eso
  // es un 500 `FUNCTION_INVOCATION_FAILED`, no el `503 MISCONFIGURED`
  // documentado (docs/escrow-interface.md §6).
  let serverConfig: ReturnType<typeof getServerConfig>;
  let clients: ReturnType<typeof getRelayerClients>;
  try {
    serverConfig = getServerConfig();
    clients = getRelayerClients();
  } catch (err) {
    console.error("[kuska] /api/faucet: configuración del servidor inválida:", err);
    return Response.json({ code: "MISCONFIGURED" }, { status: 503 });
  }

  // en mainnet el faucet no existe, ni siquiera hay que parsear el body
  if (serverConfig.chainId === 177) {
    return Response.json({ code: "NOT_FOUND" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ code: "INVALID_REQUEST" }, { status: 400 });
  }

  const { publicClient, walletClient } = clients;

  const deps: FaucetDeps = {
    publicClient,
    walletClient,
    relayerAccount: serverConfig.relayerAccount,
    tokenAddress: serverConfig.tokenAddress,
    chainId: serverConfig.chainId,
  };

  const clientIp = getClientIp(request.headers);
  const result = await handleFaucet(body, deps, clientIp);
  return Response.json(result.body, { status: result.status });
}
