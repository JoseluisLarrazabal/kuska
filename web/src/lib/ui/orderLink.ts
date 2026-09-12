import type { Hex } from "viem";

const HEX32_RE = /0x[0-9a-fA-F]{64}/;

/** URL de confirmación que se codifica en el QR que muestra el vendedor. */
export function buildConfirmUrl(orderRef: Hex): string {
  return `${window.location.origin}/pedido/${orderRef}?accion=liberar`;
}

/** Extrae un `orderRef` (bytes32) de un texto escaneado o pegado a mano: acepta la URL completa o el hex pelado. */
export function parseOrderRefFromText(text: string): Hex | undefined {
  const match = text.match(HEX32_RE);
  return match ? (match[0] as Hex) : undefined;
}
