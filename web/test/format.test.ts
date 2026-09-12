import { describe, expect, it } from "vitest";
import { parseAmountInput } from "../src/lib/ui/format";

describe("parseAmountInput", () => {
  it("rechaza notación científica (pasaba con Number, rompía parseUnits)", () => {
    expect(parseAmountInput("1e3")).toBeUndefined();
  });

  it("rechaza más decimales que los 6 del token (pasaba con Number, redondeaba a 0n)", () => {
    expect(parseAmountInput("0.0000001")).toBeUndefined();
  });

  it("acepta espacios alrededor recortándolos (pasaba con Number, tiraba en BigInt)", () => {
    expect(parseAmountInput(" 10 ")).toBe(10_000_000n);
  });

  it("acepta un monto normal entero", () => {
    expect(parseAmountInput("10")).toBe(10_000_000n);
  });

  it("acepta un monto normal con decimales", () => {
    expect(parseAmountInput("12.5")).toBe(12_500_000n);
  });

  it("acepta exactamente 6 decimales (el mínimo representable)", () => {
    expect(parseAmountInput("0.000001")).toBe(1n);
  });

  it("rechaza 0", () => {
    expect(parseAmountInput("0")).toBeUndefined();
  });

  it("rechaza negativos", () => {
    expect(parseAmountInput("-5")).toBeUndefined();
  });

  it("rechaza vacío y no numérico", () => {
    expect(parseAmountInput("")).toBeUndefined();
    expect(parseAmountInput("abc")).toBeUndefined();
  });
});
