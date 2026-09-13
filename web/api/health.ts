import { getServerConfig } from "../server/config.js";
import { getRelayerClients } from "../server/clients.js";
import { handleHealth } from "../server/health.js";

// Para proyectos "other" (no-Next, este caso) el `config` object sigue siendo
// el mecanismo documentado -- la alternativa `export const maxDuration`
// "pelada" (route segment options) es específica de Next.js App Router (ver
// https://vercel.com/docs/functions/functions-api-reference?framework=other,
// sección "config object": el bloque ["other"] solo muestra `config`).
export const config = {
  maxDuration: 10,
};

// Vercel Functions (Node.js runtime) despacha por método a la named export
// que matchee (`GET`, `POST`, ...) -- un `export default` se trata como la
// firma legacy `(req, res) => void` e ignora el `Response` devuelto (ver
// docs/handoff.md). Este handler solo sirve GET, así que exporta únicamente
// `GET`; cualquier otro método lo devuelve Vercel mismo como 405.
export async function GET(_request: Request): Promise<Response> {
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
