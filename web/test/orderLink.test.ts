import { describe, expect, it } from "vitest";
import { MAX_ITEM_LENGTH, parseItemFromText, parseOrderRefFromText } from "../src/lib/ui/orderLink";

const REF = `0x${"a".repeat(64)}`;

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
});
