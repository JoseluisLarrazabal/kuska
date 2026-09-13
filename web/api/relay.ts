import { getServerConfig } from "../server/config.js";
import { getRelayerClients } from "../server/clients.js";
import { handleRelay, type RelayDeps } from "../server/relay.js";

// Vercel Functions (Node.js runtime, firma estándar Web Fetch para proyectos
// no-Next — ver "Create Vercel Function for Other Frameworks",
// https://vercel.com/docs/functions/quickstart).
export const config = {
  maxDuration: 30,
};

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ code: "INVALID_REQUEST" }, { status: 405 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ code: "INVALID_REQUEST" }, { status: 400 });
  }

  // `getServerConfig`/`getRelayerClients` tiran un `Error` pelado si falta o
  // es inválida una env var del servidor (p. ej. `RELAYER_PRIVATE_KEY`). Sin
  // este try/catch, en Vercel eso es un 500 `FUNCTION_INVOCATION_FAILED` sin
  // cuerpo JSON, no el `503 MISCONFIGURED` documentado (docs/escrow-interface.md §6).
  let serverConfig: ReturnType<typeof getServerConfig>;
  let clients: ReturnType<typeof getRelayerClients>;
  try {
    serverConfig = getServerConfig();
    clients = getRelayerClients();
  } catch (err) {
    console.error("[kuska] /api/relay: configuración del servidor inválida:", err);
    return Response.json({ code: "MISCONFIGURED" }, { status: 503 });
  }
  const { publicClient, walletClient } = clients;

  const deps: RelayDeps = {
    publicClient,
    walletClient,
    relayerAccount: serverConfig.relayerAccount,
    escrowAddress: serverConfig.escrowAddress,
    chainId: serverConfig.chainId,
  };

  const result = await handleRelay(body, deps);
  return Response.json(result.body, { status: result.status });
}
