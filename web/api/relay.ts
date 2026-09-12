import { getServerConfig } from "../server/config";
import { getRelayerClients } from "../server/clients";
import { handleRelay, type RelayDeps } from "../server/relay";

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

  const serverConfig = getServerConfig();
  const { publicClient, walletClient } = getRelayerClients();

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
