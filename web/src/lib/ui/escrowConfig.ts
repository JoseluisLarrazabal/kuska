import { useQuery } from "@tanstack/react-query";
import { kuskaEscrowAbi } from "../escrow/abi";
import { getDeploymentConfig } from "../../config/deployment";
import { getPublicClient } from "./viemClient";

/** `disputeWindow` del deploy de demo (docs/escrow-interface.md §4): 90s. Fallback mientras se lee el valor real del contrato (es inmutable). */
export const DEFAULT_DISPUTE_WINDOW_SECONDS = 90n;

/**
 * Lee `disputeWindow()` del escrow. No vive en `lib/escrow/read.ts` (solo
 * expone `getDeal`); mismo patrón de lectura directa que ya usa
 * `resolveTokenDomain` en `typedData.ts`. Es inmutable (fijado en el
 * constructor), así que react-query lo cachea con `staleTime: Infinity`.
 */
export function useDisputeWindow() {
  return useQuery({
    queryKey: ["disputeWindow"],
    queryFn: async () => {
      const { escrowAddress } = getDeploymentConfig();
      return getPublicClient().readContract({
        address: escrowAddress,
        abi: kuskaEscrowAbi,
        functionName: "disputeWindow",
      });
    },
    staleTime: Infinity,
    initialData: DEFAULT_DISPUTE_WINDOW_SECONDS,
  });
}
