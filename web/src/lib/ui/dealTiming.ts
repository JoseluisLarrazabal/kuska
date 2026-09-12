import { DealState, type Deal } from "../escrow/read";

/**
 * Lógica pura (sin React, sin `Date.now()` implícito) detrás de las acciones
 * por tiempo de `Order.tsx`/`Seller.tsx`. Recibe `nowSec` como parámetro (en
 * vez de leer el reloj adentro) para que sea testeable con casos de borde
 * exactos, y para que un solo `useNow()` en el componente alimente a las
 * tres sin desincronizarse entre sí.
 */

export type OrderRole = "buyer" | "seller" | undefined;

/**
 * ¿Se puede pedir el reembolso por vencimiento del plazo de entrega?
 * `refundExpired` (docs/escrow-interface.md §3) solo tiene sentido para el
 * comprador, con el deal todavía `Funded`, y una vez que `deliveryDeadline`
 * ya pasó (comparación estrictamente mayor, igual que el contrato).
 */
export function canRequestRefund(
  deal: Pick<Deal, "state" | "deliveryDeadline">,
  role: OrderRole,
  nowSec: number,
): boolean {
  return deal.state === DealState.Funded && role === "buyer" && nowSec > Number(deal.deliveryDeadline);
}

/**
 * ¿Se puede abrir una disputa? Mientras el `disputeWindow` real todavía no
 * se confirmó del contrato (`isWindowGuess: true`, ver `useDisputeWindow`),
 * se mantiene disponible a propósito: ocultarla en base a una adivinanza
 * podría negarle al comprador una disputa legítima. Una vez confirmado el
 * valor real, solo dentro de la ventana (estrictamente antes del deadline).
 */
export function canOpenDisputeWindow(disputeDeadline: bigint | undefined, isWindowGuess: boolean, nowSec: number): boolean {
  if (disputeDeadline === undefined) return false;
  if (isWindowGuess) return true;
  return nowSec < Number(disputeDeadline);
}

/**
 * ¿Se puede liberar el pago automáticamente por ventana de disputa vencida?
 * Nunca mientras el `disputeWindow` real es una adivinanza (`isWindowGuess`):
 * ofrecerla en base a un valor no confirmado podría mostrar la acción antes
 * de que el contrato realmente la acepte. Una vez confirmado, disponible
 * desde que `nowSec` alcanza el deadline (inclusive).
 */
export function canReleaseAfterWindow(disputeDeadline: bigint | undefined, isWindowGuess: boolean, nowSec: number): boolean {
  if (isWindowGuess || disputeDeadline === undefined) return false;
  return nowSec >= Number(disputeDeadline);
}
