import type { Hex } from "viem";

const HEX32_RE = /0x[0-9a-fA-F]{64}/;
const ITEM_QUERY_RE = /[?&]item=([^&\s]*)/;

/** Largo máximo de un `item` pegado desde un link — cota defensiva, no hay límite en el contrato (nunca se guarda en cadena, ver `Buy.tsx`). */
export const MAX_ITEM_LENGTH = 120;

/** URL de confirmación que se codifica en el QR que muestra el vendedor. */
export function buildConfirmUrl(orderRef: Hex): string {
  return `${window.location.origin}/pedido/${orderRef}?accion=liberar`;
}

/** Extrae un `orderRef` (bytes32) de un texto escaneado o pegado a mano: acepta la URL completa o el hex pelado. */
export function parseOrderRefFromText(text: string): Hex | undefined {
  const match = text.match(HEX32_RE);
  return match ? (match[0] as Hex) : undefined;
}

/**
 * Extrae el label humano (`?item=...`) de un link pegado por el comprador
 * (`/pedido/<ref>?item=...`, ver `buildConfirmUrl`/`Buy.tsx`), para que la
 * tarjeta del vendedor no pierda el label al agregar el pedido por link.
 *
 * A propósito NO usa `new URL(text)`: el texto pegado puede no ser una URL
 * absoluta válida (o venir con basura alrededor), y el requisito de
 * seguridad es el mismo que en `parseOrderRefFromText` — nunca se usa el
 * origen ni el path del texto pegado para nada (ni navegación, ni
 * confianza), solo se lee el valor del query param `item` con una regex y se
 * decodifica. El resultado se renderiza siempre como texto de React (nunca
 * `dangerouslySetInnerHTML`) y se recorta a `MAX_ITEM_LENGTH` caracteres.
 */
export function parseItemFromText(text: string): string | undefined {
  const match = text.match(ITEM_QUERY_RE);
  if (!match || !match[1]) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(match[1]);
  } catch {
    return undefined; // percent-encoding malformado
  }
  const trimmed = decoded.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.length > MAX_ITEM_LENGTH ? trimmed.slice(0, MAX_ITEM_LENGTH) : trimmed;
}
