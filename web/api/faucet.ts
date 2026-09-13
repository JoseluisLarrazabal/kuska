import { getServerConfig } from "../server/config.js";
import { getRelayerClients } from "../server/clients.js";
import { getClientIp } from "../server/clientIp.js";
import { handleFaucet, type FaucetDeps } from "../server/faucet.js";

// Para proyectos "other" (no-Next, este caso) el `config` object sigue siendo
// el mecanismo documentado -- la alternativa `export const maxDuration`
// "pelada" (route segment options) es específica de Next.js App Router (ver
// https://vercel.com/docs/functions/functions-api-reference?framework=other,
// sección "config object": el bloque ["other"] solo muestra `config`).
export const config = {
  maxDuration: 30,
};

// Vercel Functions (Node.js runtime) despacha por método a la named export
// que matchee (`GET`, `POST`, ...) -- un `export default` se trata como la
// firma legacy `(req, res) => void` e ignora el `Response` devuelto (ver
// docs/handoff.md). Este handler solo sirve POST, así que exporta únicamente
// `POST`; cualquier otro método lo devuelve Vercel mismo como 405.
export async function POST(request: Request): Promise<Response> {
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
