import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAccount, getOrCreateAccount } from "../src/lib/burner";
import { isBurnerPersistent } from "../src/lib/ui/burnerStatus";

/** `localStorage` en memoria, para simular un dispositivo que sí persiste. */
function createFakeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
}

describe("isBurnerPersistent — orden de evaluación respecto de la creación de cuenta", () => {
  beforeEach(() => {
    clearAccount();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("regresión Buy.tsx: llamada ANTES de crear la cuenta da un falso negativo en la primera visita", () => {
    vi.stubGlobal("window", { localStorage: createFakeLocalStorage() });

    // Primera visita: todavía no hay ninguna llave en `localStorage`. Este es
    // exactamente el bug de `Buy.tsx:45` (llamaba `isBurnerPersistent()`
    // antes de `getOrCreateAccount()` en la línea 48): aunque el guardado va
    // a funcionar perfectamente, acá todavía reporta `false`.
    expect(isBurnerPersistent()).toBe(false);
  });

  it("llamada DESPUÉS de crear la cuenta refleja que sí quedó guardada (el fix)", () => {
    vi.stubGlobal("window", { localStorage: createFakeLocalStorage() });

    getOrCreateAccount();
    // Con `localStorage` funcionando, para cuando la cuenta ya se creó,
    // `isBurnerPersistent()` tiene que reportar `true` — es el orden que
    // `Buy.tsx` usa ahora (cuenta primero, aviso después).
    expect(isBurnerPersistent()).toBe(true);
  });

  it("con localStorage roto, sigue reportando false incluso después de crear la cuenta", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("localStorage bloqueado");
        },
        setItem: () => {
          throw new Error("localStorage bloqueado");
        },
        removeItem: () => {
          throw new Error("localStorage bloqueado");
        },
      },
    });

    getOrCreateAccount();
    expect(isBurnerPersistent()).toBe(false);
  });
});
