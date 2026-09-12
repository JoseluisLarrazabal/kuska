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

  const serverConfig = getServerConfig();
  const { publicClient } = getRelayerClients();

  const result = await handleHealth({
    publicClient,
    relayerAccount: serverConfig.relayerAccount,
    escrowAddress: serverConfig.escrowAddress,
    tokenAddress: serverConfig.tokenAddress,
    chainId: serverConfig.chainId,
  });

  return Response.json(result, { status: 200 });
}
