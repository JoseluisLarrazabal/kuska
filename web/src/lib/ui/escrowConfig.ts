import { useQuery } from "@tanstack/react-query";
import { kuskaEscrowAbi } from "../escrow/abi";
import { getDeploymentConfig } from "../../config/deployment";
import { getPublicClient } from "./viemClient";

/** `disputeWindow` del deploy de demo (docs/escrow-interface.md §4): 90s. Valor de arranque mientras se confirma el real del contrato (ver `isPlaceholderData` de `useDisputeWindow`). */
export const DEFAULT_DISPUTE_WINDOW_SECONDS = 90n;

/** Cada cuánto reintentar `disputeWindow()` mientras todavía no se confirmó un valor real. */
const DISPUTE_WINDOW_RETRY_INTERVAL_MS = 5000;

/**
 * `refetchInterval` de `useDisputeWindow()`: sigue reintentando cada
 * `DISPUTE_WINDOW_RETRY_INTERVAL_MS` mientras `query.state.dataUpdatedAt` siga
 * en `0` (todavía no hubo ningún fetch exitoso — el `placeholderData` NO
 * cuenta como éxito, así que `dataUpdatedAt` se queda en `0` mientras se sirve
 * el valor por defecto o mientras el query está en estado de error) y deja de
 * reintentar (`false`) apenas se confirma un valor real, porque
 * `disputeWindow()` es inmutable y `staleTime: Infinity` ya lo cachea para
 * siempre.
 *
 * Sin esto: si la lectura fallaba después de agotar los reintentos internos
 * de react-query (con `staleTime: Infinity` y sin `refetchInterval`, react-
 * query no vuelve a intentar solo — hace falta refocus/remount), la UI se
 * quedaba sirviendo `DEFAULT_DISPUTE_WINDOW_SECONDS` (90s) para siempre.
 * `Order.tsx` usa ese valor tanto para decidir cuándo ofrecer "Liberar pago"
 * (`canReleaseAfterWindow`) como para ocultar "Abrir disputa"
 * (`canOpenDisputeWindow`) — con un default equivocado, "Liberar pago" no
 * aparecía cuando la ventana real ya había vencido, y se seguía ofreciendo
 * "Abrir disputa" después de vencida (revierte `DisputeWindowClosed`).
 *
 * Exportada (en vez de definida inline) para poder testear la lógica de
 * reintento sin depender de React/react-query en el test.
 */
export function disputeWindowRefetchInterval(query: {
  state: { dataUpdatedAt: number };
}): number | false {
  return query.state.dataUpdatedAt === 0 ? DISPUTE_WINDOW_RETRY_INTERVAL_MS : false;
}

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
    refetchInterval: disputeWindowRefetchInterval,
  });
}
