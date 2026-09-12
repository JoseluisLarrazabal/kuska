import { describe, expect, it } from "vitest";
import { chunkBlockRange, mergeSellerOrderRefs, MAX_LOG_BLOCK_RANGE } from "../src/lib/ui/useSellerDeals";
import type { Hex } from "viem";

describe("chunkBlockRange", () => {
  it("un rango que entra en una sola ventana devuelve un solo chunk", () => {
    expect(chunkBlockRange(100n, 200n, 1000n)).toEqual([{ fromBlock: 100n, toBlock: 200n }]);
  });

  it("parte un rango más grande que maxRange en ventanas consecutivas sin huecos ni superposición", () => {
    const chunks = chunkBlockRange(0n, 250n, 100n);
    expect(chunks).toEqual([
      { fromBlock: 0n, toBlock: 99n },
      { fromBlock: 100n, toBlock: 199n },
      { fromBlock: 200n, toBlock: 250n },
    ]);
  });

  it("un rango exacto múltiplo de maxRange no deja un chunk final vacío", () => {
    const chunks = chunkBlockRange(0n, 199n, 100n);
    expect(chunks).toEqual([
      { fromBlock: 0n, toBlock: 99n },
      { fromBlock: 100n, toBlock: 199n },
    ]);
  });

  it("fromBlock == toBlock devuelve un chunk de un solo bloque", () => {
    expect(chunkBlockRange(50n, 50n, 100n)).toEqual([{ fromBlock: 50n, toBlock: 50n }]);
  });

  it("toBlock < fromBlock devuelve sin chunks (nunca debería pasar, pero no debe tirar)", () => {
    expect(chunkBlockRange(100n, 50n, 100n)).toEqual([]);
  });

  it("tira si maxRange no es positivo", () => {
    expect(() => chunkBlockRange(0n, 10n, 0n)).toThrow();
    expect(() => chunkBlockRange(0n, 10n, -1n)).toThrow();
  });

  it("cubre el rango realista del deploy (deployBlock 32996664, ~26k bloques) en un solo chunk bajo MAX_LOG_BLOCK_RANGE", () => {
    const chunks = chunkBlockRange(32_996_664n, 32_996_664n + 26_000n, MAX_LOG_BLOCK_RANGE);
    expect(chunks).toHaveLength(1);
  });
});

const REF_A = `0x${"a".repeat(64)}` as Hex;
const REF_B = `0x${"b".repeat(64)}` as Hex;
const REF_C = `0x${"c".repeat(64)}` as Hex;

describe("mergeSellerOrderRefs", () => {
  it("sin descubiertos, devuelve los trackeados tal cual", () => {
    expect(mergeSellerOrderRefs([], [REF_A, REF_B])).toEqual([REF_A, REF_B]);
  });

  it("sin trackeados, devuelve los descubiertos más nuevo primero (orden ascendente de bloque invertido)", () => {
    expect(mergeSellerOrderRefs([REF_A, REF_B], [])).toEqual([REF_B, REF_A]);
  });

  it("dedupea un ref presente en ambas listas, sin repetirlo", () => {
    const merged = mergeSellerOrderRefs([REF_A, REF_B], [REF_B, REF_C]);
    expect(merged).toEqual([REF_B, REF_A, REF_C]);
  });

  it("dedupea sin importar mayúsculas/minúsculas", () => {
    const upper = REF_A.toUpperCase() as Hex;
    const merged = mergeSellerOrderRefs([REF_A], [upper]);
    expect(merged).toHaveLength(1);
  });

  it("los descubiertos van antes que los trackeados exclusivos (más nuevo primero)", () => {
    expect(mergeSellerOrderRefs([REF_A], [REF_C])).toEqual([REF_A, REF_C]);
  });
});
