import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";
import { buildConfirmUrl, MAX_ITEM_LENGTH, parseItemFromText, parseOrderRefFromText } from "../src/lib/ui/orderLink";

const REF = `0x${"a".repeat(64)}` as Hex;

const ORIGIN = "https://kuska.app";

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
