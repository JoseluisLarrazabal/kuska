import { describe, expect, it } from "vitest";
import { disputeWindowRefetchInterval } from "../src/lib/ui/escrowConfig";

describe("disputeWindowRefetchInterval", () => {
  it("sigue reintentando mientras no hay ningún fetch exitoso confirmado (dataUpdatedAt en 0)", () => {
    // Cubre tanto "todavía no resolvió" como "falló tras agotar los
    // reintentos internos de react-query": en ambos casos `dataUpdatedAt`
    // se queda en 0 (el `placeholderData` no lo mueve — no cuenta como un
    // fetch exitoso). Sin esto, con `staleTime: Infinity` y sin
    // `refetchInterval`, un fallo inicial dejaba el valor por defecto (90s)
    // para siempre, sin más reintentos automáticos.
    expect(disputeWindowRefetchInterval({ state: { dataUpdatedAt: 0 } })).toBe(5000);
  });

  it("deja de reintentar apenas se confirma un valor real (dataUpdatedAt > 0)", () => {
    expect(disputeWindowRefetchInterval({ state: { dataUpdatedAt: Date.now() } })).toBe(false);
  });
});
