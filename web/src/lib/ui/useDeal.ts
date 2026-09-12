import { useQuery } from "@tanstack/react-query";
import type { Hex } from "viem";
import { getDeal, type Deal } from "../escrow/read";
import { getDeploymentConfig } from "../../config/deployment";
import { getPublicClient } from "./viemClient";

/** Lee y refresca (cada 4s) el estado de un deal via `lib/escrow/read.ts#getDeal`. */
export function useDeal(orderRef: Hex | undefined) {
  return useQuery<Deal>({
    queryKey: ["deal", orderRef],
    queryFn: async () => {
      if (!orderRef) throw new Error("orderRef requerido");
      const { escrowAddress } = getDeploymentConfig();
      return getDeal(getPublicClient(), escrowAddress, orderRef);
    },
    enabled: Boolean(orderRef),
    refetchInterval: 4000,
    retry: 2,
  });
}
