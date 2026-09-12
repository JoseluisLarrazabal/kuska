import { getServerConfig } from "../server/config";
import { getRelayerClients } from "../server/clients";
import { handleHealth } from "../server/health";

export const config = {
  maxDuration: 10,
};

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    return Response.json({ code: "INVALID_REQUEST" }, { status: 405 });
  }

  // `getServerConfig`/`getRelayerClients` tiran un `Error` pelado si falta o
  // es inválida una env var del servidor. Sin este try/catch, en Vercel eso
  // es un 500 `FUNCTION_INVOCATION_FAILED`, no el `503 MISCONFIGURED`
  // documentado (docs/escrow-interface.md §6).
  let serverConfig: ReturnType<typeof getServerConfig>;
  let publicClient: ReturnType<typeof getRelayerClients>["publicClient"];
  try {
    serverConfig = getServerConfig();
    ({ publicClient } = getRelayerClients());
  } catch (err) {
    console.error("[kuska] /api/health: configuración del servidor inválida:", err);
    return Response.json({ code: "MISCONFIGURED" }, { status: 503 });
  }

  const result = await handleHealth({
    publicClient,
    relayerAccount: serverConfig.relayerAccount,
    escrowAddress: serverConfig.escrowAddress,
    tokenAddress: serverConfig.tokenAddress,
    chainId: serverConfig.chainId,
  });

  return Response.json(result, { status: 200 });
}
