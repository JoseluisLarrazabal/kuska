import { describe, expect, it } from "vitest";
import {
  endSentence,
  formatDeadline,
  formatHskAmount,
  insufficientFundsMessage,
  parseAmountInput,
} from "../src/lib/ui/format";

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

describe("formatHskAmount", () => {
  it("formatea 0 como '0'", () => {
    expect(formatHskAmount(0n)).toBe("0");
  });

  it("recorta el saldo de 18 decimales del bug real a 4 decimales significativos", () => {
    // 0.099480426354340893 HSK — el bug: se mostraba entero, sin formatear.
    expect(formatHskAmount(99_480_426_354_340_893n)).toBe("0.09948");
  });

  it("no redondea a 0 un saldo chico pero real (serían 4 ceros con decimales fijos)", () => {
    // 0.0000012345 HSK: con 4 decimales FIJOS esto sería "0.0000" (parece vacío).
    // Con decimales SIGNIFICATIVOS (contados desde el primer dígito no-cero) se
    // muestran los 4 dígitos significativos "1234", redondeados por el "5" que sigue.
    expect(formatHskAmount(1_234_500_000_000n)).toBe("0.000001235");
  });

  it("un saldo con parte entera usa 4 decimales fijos y recorta ceros finales", () => {
    expect(formatHskAmount(12_500_000_000_000_000_000n)).toBe("12.5");
  });

  it("un saldo entero exacto no muestra decimales", () => {
    expect(formatHskAmount(3_000_000_000_000_000_000n)).toBe("3");
  });

  it("redondea hacia arriba (half up) al cortar decimales", () => {
    // 0.099999 HSK → con 4 decimales significativos desde el primer 9, corta y redondea a 0.1
    expect(formatHskAmount(99_999_000_000_000_000n)).toBe("0.1");
  });

  it("nunca usa notación científica, ni para valores muy chicos", () => {
    expect(formatHskAmount(1n)).not.toMatch(/e/i);
    expect(formatHskAmount(1n).length).toBeGreaterThan(0);
  });
});

describe("formatDeadline", () => {
  const sameDayNow = Date.UTC(2026, 8, 13, 10, 0, 0) / 1000; // 13 sept 2026, 10:00 UTC

  it("mismo día que `nowSeconds`: solo devuelve la hora, sin fecha", () => {
    const deadline = Date.UTC(2026, 8, 13, 22, 30, 0) / 1000;
    const result = formatDeadline(deadline, sameDayNow);
    expect(result).not.toMatch(/sept/i);
  });

  it("otro día: antepone la fecha a la hora", () => {
    const deadline = Date.UTC(2026, 8, 20, 22, 30, 0) / 1000;
    const result = formatDeadline(deadline, sameDayNow);
    expect(result).toMatch(/^\d{1,2} \w+.*,/);
  });

  it("acepta bigint para `unixSeconds`", () => {
    expect(() => formatDeadline(BigInt(sameDayNow) + 3600n, sameDayNow)).not.toThrow();
  });
});

describe("insufficientFundsMessage", () => {
  it("muestra ambos montos formateados con 2 decimales, en unidades legibles", () => {
    const message = insufficientFundsMessage(0n, 25_000_000n);
    expect(message).toContain("necesitás 25.00");
    expect(message).toContain("tenés 0.00");
  });

  it("redondea a 2 decimales igual que `formatDemoUsd`", () => {
    const message = insufficientFundsMessage(3_456_789n, 10_000_000n);
    expect(message).toContain("tenés 3.45");
  });

  it("menciona el botón del faucet como salida", () => {
    expect(insufficientFundsMessage(0n, 1_000_000n)).toMatch(/botón de arriba/i);
  });
});

describe("endSentence", () => {
  it("agrega un punto si el texto no termina en uno", () => {
    expect(endSentence("hola")).toBe("hola.");
  });

  it("no duplica el punto si el texto ya termina en uno", () => {
    expect(endSentence("10:30 p. m.")).toBe("10:30 p. m.");
  });

  it("no duplica el punto si termina en punto con espacios finales", () => {
    expect(endSentence("listo. ")).toBe("listo. ");
  });
});
