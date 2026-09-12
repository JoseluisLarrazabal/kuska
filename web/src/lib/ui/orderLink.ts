import type { Hex } from "viem";

const HEX32_RE = /0x[0-9a-fA-F]{64}/;
const ITEM_QUERY_RE = /[?&]item=([^&#\s]*)/;

/** Largo máximo de un `item` pegado desde un link — cota defensiva, no hay límite en el contrato (nunca se guarda en cadena, ver `Buy.tsx`). */
export const MAX_ITEM_LENGTH = 120;

/**
 * Recorta un `item` a `MAX_ITEM_LENGTH` **por code point**, no por unidad
 * UTF-16: `String#slice` cuenta unidades UTF-16, así que un texto con un
 * carácter fuera del BMP (p. ej. un emoji, que ocupa un par subrogado de 2
 * unidades) justo en el borde del corte puede partir el par y dejar un
 * subrogado suelto — `encodeURIComponent` tira `URIError` con eso, lo que
 * rompía el render de la tarjeta del vendedor (`Seller.tsx`, QR de
 * `buildConfirmUrl`). `Array.from` sí itera por code point, así que el corte
 * nunca cae en el medio de un par subrogado.
 */
export function capItem(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return "";
  return Array.from(trimmed).slice(0, MAX_ITEM_LENGTH).join("");
}

/**
 * URL de confirmación que se codifica en el QR que muestra el vendedor.
 * Si el pedido tiene un `item` (label humano trackeado del lado del
 * vendedor), se propaga como query param para que `Deliver.tsx`
 * (`parseItemFromText`) pueda recuperarlo al escanear — sin esto el label
 * se perdía apenas el comprador escaneaba el QR del vendedor.
 *
 * Nunca tira: `capItem` recorta por code point antes de `encodeURIComponent`,
 * así que ningún `item` de entrada (por más largo o con los emojis que sea)
 * puede romper esta función.
 */
export function buildConfirmUrl(orderRef: Hex, item?: string): string {
  const base = `${window.location.origin}/pedido/${orderRef}?accion=liberar`;
  if (!item) return base;
  const capped = capItem(item);
  if (!capped) return base;
  return `${base}&item=${encodeURIComponent(capped)}`;
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
 * `dangerouslySetInnerHTML`) y se recorta con `capItem` (por code point, ver
 * `capItem`) a `MAX_ITEM_LENGTH`.
 */
export function parseItemFromText(text: string): string | undefined {
  const match = text.match(ITEM_QUERY_RE);
  if (!match || !match[1]) return undefined;
  let decoded: string;
  try {
    // Semántica de query string form-urlencoded (igual que `URLSearchParams`):
    // `+` representa un espacio, no un `+` literal.
    decoded = decodeURIComponent(match[1].replace(/\+/g, " "));
  } catch {
    return undefined; // percent-encoding malformado
  }
  const capped = capItem(decoded);
  return capped.length === 0 ? undefined : capped;
}
