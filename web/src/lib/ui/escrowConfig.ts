import { useQuery } from "@tanstack/react-query";
import { kuskaEscrowAbi } from "../escrow/abi";
import { getDeploymentConfig } from "../../config/deployment";
import { getPublicClient } from "./viemClient";

/** `disputeWindow` del deploy de demo (docs/escrow-interface.md §4): 90s. Valor de arranque mientras se confirma el real del contrato (ver `isPlaceholderData` de `useDisputeWindow`). */
export const DEFAULT_DISPUTE_WINDOW_SECONDS = 90n;

/**
 * Lee `disputeWindow()` del escrow. No vive en `lib/escrow/read.ts` (solo
 * expone `getDeal`); mismo patrón de lectura directa que ya usa
 * `resolveTokenDomain` en `typedData.ts`. Es inmutable (fijado en el
 * constructor): una vez confirmado el valor real, `staleTime: Infinity` evita
 * refetches innecesarios.
 *
 * Usa `placeholderData` a propósito, NO `initialData`: con react-query v5,
 * `initialData` + `staleTime: Infinity` cuenta como dato ya fresco desde el
 * primer render, así que `queryFn` nunca llega a correr y la UI usaba para
 * siempre el valor por defecto sin leer jamás la cadena. `placeholderData`
 * muestra el valor por defecto de inmediato SIN marcar el query como
 * resuelto: sigue disparando `queryFn`, y `isPlaceholderData` (parte del
 * resultado de `useQuery`) le permite a quien consuma este hook distinguir
 * "todavía es una adivinanza" de "ya confirmado en cadena" — usar eso para
 * decidir con criterio conservador si ofrecer `releaseAfterWindow` o si
 * ocultar `dispute`, en vez de confiar en el valor por defecto.
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
    placeholderData: DEFAULT_DISPUTE_WINDOW_SECONDS,
  });
}
