import type { Address, Hex, PublicClient } from "viem";
import { kuskaEscrowAbi } from "./abi";

/** `enum State { None, Funded, DeliveryClaimed, Disputed, Released, Refunded }` (0..5). */
export enum DealState {
  None = 0,
  Funded = 1,
  DeliveryClaimed = 2,
  Disputed = 3,
  Released = 4,
  Refunded = 5,
}

/** Etiquetas de UI en español (docs/escrow-interface.md sección 4). */
export const dealStateLabels: Record<DealState, string> = {
  [DealState.None]: "—",
  [DealState.Funded]: "En custodia",
  [DealState.DeliveryClaimed]: "Entrega registrada",
  [DealState.Disputed]: "En disputa",
  [DealState.Released]: "Liberado",
  [DealState.Refunded]: "Reembolsado",
};

export interface Deal {
  buyer: Address;
  amount: bigint;
  seller: Address;
  deliveryDeadline: bigint;
  claimedAt: bigint;
  state: DealState;
  stateLabel: string;
}

/**
 * Lee un deal del escrow y lo devuelve tipado con `state` como enum + label.
 *
 * Nota: la interfaz (docs/escrow-interface.md §4) describe la firma como
 * `getDeal(client, orderRef)`, sin la dirección del escrow. Como el SDK no
 * debe fijar una dirección global (rompería la inyección de dependencias que
 * usa el relayer para testear con mocks), se agrega `escrowAddress` como
 * tercer parámetro explícito — desvío mínimo y seguro documentado en el
 * reporte final.
 */
export async function getDeal(
  client: PublicClient,
  escrowAddress: Address,
  orderRef: Hex,
): Promise<Deal> {
  const deal = await client.readContract({
    address: escrowAddress,
    abi: kuskaEscrowAbi,
    functionName: "getDeal",
    args: [orderRef],
  });

  // `deal.state` es un `uint8` tal cual viene de la cadena: un estado fuera
  // de 0-5 (contrato desactualizado, red equivocada, etc.) no está en
  // `dealStateLabels` y el cast `as DealState` no lo detecta en runtime.
  // Validar el rango explícitamente en vez de confiar en el cast, para que
  // `stateLabel` siga siendo siempre un `string` como promete `Deal`.
  const rawState = deal.state as number;
  const state = rawState in DealState ? (rawState as DealState) : undefined;
  return {
    buyer: deal.buyer,
    amount: deal.amount,
    seller: deal.seller,
    deliveryDeadline: deal.deliveryDeadline,
    claimedAt: deal.claimedAt,
    state: state ?? (rawState as DealState),
    stateLabel: state !== undefined ? dealStateLabels[state] : `Desconocido (${rawState})`,
  };
}
