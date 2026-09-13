import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import {
  describeFaucetFailure,
  relayErrorMaybeSentTx,
  type FaucetOutcome,
  type RelayOutcomeError,
} from "../src/lib/ui/relayer";

function err(code: string, hash?: Hex): RelayOutcomeError {
  return { code, message: "irrelevante para la clasificación", hash };
}

describe("relayErrorMaybeSentTx", () => {
  // Códigos que PRUEBAN que `writeContract` nunca se llamó (ver
  // `server/relay.ts`: todos se devuelven antes del único `writeContract` del
  // pipeline, o — para MISCONFIGURED — antes de construir `RelayDeps` en
  // `api/relay.ts`). Deny-by-default invertido: son los ÚNICOS `false`.
  it.each(["INVALID_REQUEST", "INVALID_SIGNATURE", "SIMULATION_REVERTED", "MISCONFIGURED"])(
    "%s sin hash → no se mandó ninguna tx (false)",
    (code) => {
      expect(relayErrorMaybeSentTx(err(code))).toBe(false);
    },
  );

  // RPC_ERROR se devuelve tanto ANTES de `writeContract` (isContractAddress,
  // verifySignature, simulateContract no-revert) como DESPUÉS de intentarlo
  // (writeWithNonceRetry) — el mismo código para ambos casos, así que
  // clasificar solo por código obliga a tratarlo siempre como ambiguo.
  it("RPC_ERROR sin hash → ambiguo, se trackea (true)", () => {
    expect(relayErrorMaybeSentTx(err("RPC_ERROR"))).toBe(true);
  });

  // TX_REVERTED y RECEIPT_TIMEOUT siempre traen hash (la tx llegó a mandarse).
  it("TX_REVERTED con hash → true", () => {
    expect(relayErrorMaybeSentTx(err("TX_REVERTED", "0xaaaa" as Hex))).toBe(true);
  });

  it("RECEIPT_TIMEOUT con hash → true", () => {
    expect(relayErrorMaybeSentTx(err("RECEIPT_TIMEOUT", "0xbbbb" as Hex))).toBe(true);
  });

  // Códigos que arma el propio cliente (`postRelay`), nunca `handleRelay`:
  // no prueban nada sobre si el servidor llegó a mandar la tx.
  it("NETWORK_ERROR (el fetch tiró) → ambiguo, se trackea (true)", () => {
    expect(relayErrorMaybeSentTx(err("NETWORK_ERROR"))).toBe(true);
  });

  it.each(["HTTP_504", "HTTP_500", "HTTP_502"])(
    "%s (respuesta sin JSON parseable, p. ej. timeout de plataforma de Vercel) → true",
    (code) => {
      expect(relayErrorMaybeSentTx(err(code))).toBe(true);
    },
  );

  // Cualquier código futuro/desconocido: se prefiere trackear de más (inofensivo:
  // la página del pedido lo muestra como no encontrado) a perder un `orderRef`
  // de un pedido que sí se fondeó.
  it("código desconocido → ambiguo por defecto, se trackea (true)", () => {
    expect(relayErrorMaybeSentTx(err("UN_CODIGO_QUE_TODAVIA_NO_EXISTE"))).toBe(true);
  });

  // Un `hash` presente es evidencia directa de que sí se mandó, sin importar
  // el código — ni siquiera uno de la lista "definitely not sent" debería
  // poder apagar esa señal.
  it("hash presente gana sobre cualquier código, incluso uno de la lista 'no se mandó'", () => {
    expect(relayErrorMaybeSentTx(err("INVALID_REQUEST", "0xcccc" as Hex))).toBe(true);
  });
});

function cooldown(availableAt: number | undefined): Extract<FaucetOutcome, { ok: false }> {
  return { ok: false, code: "FAUCET_COOLDOWN", message: "cooldown", availableAt };
}

describe("describeFaucetFailure", () => {
  it("agrega la hora cuando availableAt es un unix time válido y positivo", () => {
    expect(describeFaucetFailure(cooldown(1_700_000_000))).toMatch(/^cooldown Disponible a las /);
  });

  it("omite la hora si availableAt es 0 (revert sin argumento decodificado)", () => {
    expect(describeFaucetFailure(cooldown(0))).toBe("cooldown");
  });

  it("omite la hora si availableAt es NaN (postFaucet no pudo parsearlo)", () => {
    expect(describeFaucetFailure(cooldown(Number.NaN))).toBe("cooldown");
  });

  it("omite la hora si availableAt es undefined", () => {
    expect(describeFaucetFailure(cooldown(undefined))).toBe("cooldown");
  });

  it("un código que no es FAUCET_COOLDOWN nunca agrega hora, aunque traiga availableAt", () => {
    const outcome: Extract<FaucetOutcome, { ok: false }> = {
      ok: false,
      code: "NOT_FOUND",
      message: "no disponible",
      availableAt: 1_700_000_000,
    };
    expect(describeFaucetFailure(outcome)).toBe("no disponible");
  });
});
