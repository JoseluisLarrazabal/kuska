/**
 * Mapa de nombre de custom error (KuskaEscrow + MockUSD) a mensaje en
 * español sin jerga, para mostrar en la UI o en las respuestas 409 del
 * relayer (docs/escrow-interface.md §3 "Errores" y §2 `FaucetCooldown`).
 */
export const escrowErrorMessages: Record<string, string> = {
  InvalidState: "El pedido no está en el estado esperado para esta acción.",
  InvalidSignature: "La firma no es válida.",
  SignatureExpired: "La firma ya expiró.",
  InvalidAmount: "El monto no es válido.",
  InvalidAddress: "La dirección no es válida.",
  DeliveryDeadlinePassed: "El plazo de entrega ya venció.",
  DeliveryDeadlineNotReached: "El plazo de entrega todavía no venció.",
  DisputeWindowOpen: "La ventana de disputa todavía está abierta.",
  DisputeWindowClosed: "La ventana de disputa ya se cerró.",
  NotArbiter: "Solo el árbitro puede resolver esta disputa.",
  FaucetCooldown: "El faucet tiene un enfriamiento de 1 hora: todavía no podés volver a pedir fondos.",
};

const DEFAULT_MESSAGE = "La operación no se pudo completar. Intentá de nuevo.";

/** Traduce el nombre de un custom error de Solidity a un mensaje legible en español. */
export function describeEscrowError(errorName: string | undefined | null): string {
  if (!errorName) return DEFAULT_MESSAGE;
  return escrowErrorMessages[errorName] ?? DEFAULT_MESSAGE;
}
