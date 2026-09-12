import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";
import {
  buildConfirmUrl,
  capItem,
  MAX_ITEM_LENGTH,
  parseItemFromText,
  parseOrderRefFromText,
} from "../src/lib/ui/orderLink";

const REF = `0x${"a".repeat(64)}` as Hex;

const ORIGIN = "https://kuska.app";

/**
 * 119 caracteres ASCII + un emoji (par subrogado, ocupa 2 unidades UTF-16):
 * largo total en unidades UTF-16 = 121, uno más que `MAX_ITEM_LENGTH` (120).
 * `String#slice(0, 120)` corta justo en el medio del par subrogado del emoji
 * (unidad 119 = high surrogate, 120 = low surrogate) y deja un subrogado
 * suelto — eso es lo que hacía tirar `encodeURIComponent`. `capItem` corta
 * por code point, así que el emoji queda entero o afuera, nunca partido.
 */
const ASCII_119_PLUS_EMOJI = `${"x".repeat(119)}😀`;

function hasLoneSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const isHigh = code >= 0xd800 && code <= 0xdbff;
    const isLow = code >= 0xdc00 && code <= 0xdfff;
    if (isHigh) {
      const next = text.charCodeAt(i + 1);
      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) return true;
      i++; // par válido, saltar la unidad baja
    } else if (isLow) {
      return true; // unidad baja sin la alta correspondiente antes
    }
  }
  return false;
}

describe("buildConfirmUrl", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { location: { origin: ORIGIN } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sin item, arma la URL base", () => {
    expect(buildConfirmUrl(REF)).toBe(`${ORIGIN}/pedido/${REF}?accion=liberar`);
  });

  it("con item, lo agrega codificado como query param", () => {
    expect(buildConfirmUrl(REF, "40 cajas M8")).toBe(
      `${ORIGIN}/pedido/${REF}?accion=liberar&item=40%20cajas%20M8`,
    );
  });

  it("con item vacío o solo espacios, no agrega el query param", () => {
    expect(buildConfirmUrl(REF, "")).toBe(`${ORIGIN}/pedido/${REF}?accion=liberar`);
    expect(buildConfirmUrl(REF, "   ")).toBe(`${ORIGIN}/pedido/${REF}?accion=liberar`);
  });

  it("recorta el item a MAX_ITEM_LENGTH", () => {
    const long = "x".repeat(MAX_ITEM_LENGTH + 50);
    const url = buildConfirmUrl(REF, long);
    const raw = url.split("&item=").at(1) ?? "";
    expect(decodeURIComponent(raw)).toHaveLength(MAX_ITEM_LENGTH);
  });

  it("no tira con 119 ASCII + emoji (el corte por unidad UTF-16 partía el par subrogado)", () => {
    expect(() => buildConfirmUrl(REF, ASCII_119_PLUS_EMOJI)).not.toThrow();
    const url = buildConfirmUrl(REF, ASCII_119_PLUS_EMOJI);
    const raw = url.split("&item=").at(1) ?? "";
    const decoded = decodeURIComponent(raw);
    expect(hasLoneSurrogate(decoded)).toBe(false);
    // Round-trip: lo que queda en el link es exactamente lo que
    // `parseItemFromText` recupera del lado del comprador.
    expect(parseItemFromText(url)).toBe(decoded);
  });
});

describe("capItem", () => {
  it("recorta por code point, no por unidad UTF-16 (no parte pares subrogados)", () => {
    const capped = capItem(ASCII_119_PLUS_EMOJI);
    expect(hasLoneSurrogate(capped)).toBe(false);
    // 119 ASCII + 1 emoji = 120 code points, exactamente MAX_ITEM_LENGTH:
    // no hace falta cortar nada, el emoji queda entero.
    expect(capped).toBe(ASCII_119_PLUS_EMOJI);
  });

  it("recorta a MAX_ITEM_LENGTH code points cuando hay que cortar de verdad", () => {
    const long = `${"x".repeat(MAX_ITEM_LENGTH)}😀`; // 121 code points
    const capped = capItem(long);
    expect(Array.from(capped)).toHaveLength(MAX_ITEM_LENGTH);
    expect(hasLoneSurrogate(capped)).toBe(false);
    expect(capped).toBe("x".repeat(MAX_ITEM_LENGTH)); // el emoji queda afuera, entero (no partido)
  });

  it("trimea espacios antes de recortar", () => {
    expect(capItem("  hola  ")).toBe("hola");
    expect(capItem("   ")).toBe("");
  });
});

describe("parseOrderRefFromText", () => {
  it("extrae el ref de una URL completa", () => {
    expect(parseOrderRefFromText(`https://kuska.app/pedido/${REF}?item=algo`)).toBe(REF);
  });

  it("extrae el ref pelado sin URL", () => {
    expect(parseOrderRefFromText(REF)).toBe(REF);
  });

  it("devuelve undefined si no hay hex de 64 caracteres", () => {
    expect(parseOrderRefFromText("no hay nada acá")).toBeUndefined();
  });
});

describe("parseItemFromText", () => {
  it("extrae y decodifica el query param item de un link pegado", () => {
    expect(parseItemFromText(`https://kuska.app/pedido/${REF}?item=40%20cajas%20M8`)).toBe("40 cajas M8");
  });

  it("funciona con &item= (no solo ?item=)", () => {
    expect(parseItemFromText(`https://x/pedido/${REF}?accion=liberar&item=algo`)).toBe("algo");
  });

  it("devuelve undefined si no hay query param item", () => {
    expect(parseItemFromText(`https://kuska.app/pedido/${REF}`)).toBeUndefined();
    expect(parseItemFromText(REF)).toBeUndefined();
  });

  it("devuelve undefined si el item está vacío", () => {
    expect(parseItemFromText(`https://x/pedido/${REF}?item=`)).toBeUndefined();
  });

  it("nunca usa el origen ni el path del texto pegado — solo importa el query param", () => {
    // Origen/path completamente distintos, mismo resultado: la función no los toca.
    expect(parseItemFromText(`https://sitio-cualquiera.evil/otra/ruta?item=hola`)).toBe("hola");
  });

  it("recorta a MAX_ITEM_LENGTH caracteres", () => {
    const long = "x".repeat(MAX_ITEM_LENGTH + 50);
    const result = parseItemFromText(`https://x/pedido/${REF}?item=${long}`);
    expect(result).toHaveLength(MAX_ITEM_LENGTH);
  });

  it("no tira con 119 ASCII + emoji codificados en el query param", () => {
    const url = `https://x/pedido/${REF}?item=${encodeURIComponent(ASCII_119_PLUS_EMOJI)}`;
    expect(() => parseItemFromText(url)).not.toThrow();
    const result = parseItemFromText(url);
    expect(result).toBe(ASCII_119_PLUS_EMOJI);
    expect(result && hasLoneSurrogate(result)).toBe(false);
  });

  it("devuelve undefined ante percent-encoding malformado en vez de tirar", () => {
    expect(parseItemFromText(`https://x/pedido/${REF}?item=%E0%A4%A`)).toBeUndefined();
  });

  it("decodifica `+` como espacio (semántica form-urlencoded)", () => {
    expect(parseItemFromText(`https://x/pedido/${REF}?item=40+cajas`)).toBe("40 cajas");
  });

  it("no incluye el fragmento (`#...`) en el valor", () => {
    expect(parseItemFromText(`https://x/pedido/${REF}?item=cajas#seccion`)).toBe("cajas");
  });

  it("corta en el siguiente `&` cuando item no es el último query param", () => {
    expect(parseItemFromText(`https://x/pedido/${REF}?item=cajas&other=param`)).toBe("cajas");
  });
});
