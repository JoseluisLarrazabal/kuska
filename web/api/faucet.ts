import { getServerConfig } from "../server/config";
import { getRelayerClients } from "../server/clients";
import { handleFaucet, type FaucetDeps } from "../server/faucet";

export const config = {
  maxDuration: 30,
};

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ code: "INVALID_REQUEST" }, { status: 405 });
  }

  const serverConfig = getServerConfig();

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

  const { publicClient, walletClient } = getRelayerClients();

  const deps: FaucetDeps = {
    publicClient,
    walletClient,
    relayerAccount: serverConfig.relayerAccount,
    tokenAddress: serverConfig.tokenAddress,
    chainId: serverConfig.chainId,
  };

  const result = await handleFaucet(body, deps);
  return Response.json(result.body, { status: result.status });
}
