import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { getTokenBalance } from "./token";
import { getDeploymentConfig } from "../../config/deployment";
import { getPublicClient } from "./viemClient";

/**
 * Lee y refresca (cada 4s) el saldo de mUSD de una cuenta via
 * `lib/ui/token.ts#getTokenBalance`. Mismo patrón que `useDeal.ts`
 * (mismo query client, mismo estilo de queryKey/refetch).
 */
export function useTokenBalance(owner: Address | undefined) {
  return useQuery<bigint>({
    queryKey: ["tokenBalance", owner],
    queryFn: async () => {
      if (!owner) throw new Error("owner requerido");
      const { tokenAddress } = getDeploymentConfig();
      return getTokenBalance(getPublicClient(), tokenAddress, owner);
    },
    enabled: Boolean(owner),
    refetchInterval: 4000,
    retry: 2,
  });
}
