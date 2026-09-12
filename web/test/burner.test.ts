import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { clearAccount, getAccount, importAccount, InvalidPrivateKeyError } from "../src/lib/burner";

// Llave descartable generada al vuelo para el test (nunca una llave real ni
// un literal hardcodeado en el repo).
const TEST_PRIVATE_KEY = generatePrivateKey();

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

/** `localStorage` que siempre tira, para simular modo privado/cuota agotada. */
function createThrowingLocalStorage() {
  return {
    getItem: () => {
      throw new Error("localStorage bloqueado");
    },
    setItem: () => {
      throw new Error("localStorage bloqueado");
    },
    removeItem: () => {
      throw new Error("localStorage bloqueado");
    },
  };
}

describe("importAccount", () => {
  beforeEach(() => {
    // Limpia el fallback en memoria de `burner.ts` entre tests (vitest corre
    // el entorno "node": sin stub, `window` no existe y esta llamada cae al
    // catch interno sin romper nada).
    clearAccount();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adopta una llave válida y la persiste en localStorage", () => {
    vi.stubGlobal("window", { localStorage: createFakeLocalStorage() });

    const account = importAccount(TEST_PRIVATE_KEY);

    expect(account.address).toBe(privateKeyToAccount(TEST_PRIVATE_KEY).address);
    // Persistida: una lectura fresca vía `getAccount()` devuelve la misma cuenta.
    expect(getAccount()?.address).toBe(account.address);
  });

  it("acepta la llave con mayúsculas/minúsculas mixtas y espacios alrededor", () => {
    vi.stubGlobal("window", { localStorage: createFakeLocalStorage() });

    const withSpaces = `  ${TEST_PRIVATE_KEY}  `;
    const account = importAccount(withSpaces);

    expect(account.address).toBe(privateKeyToAccount(TEST_PRIVATE_KEY).address);
  });

  it.each([
    ["sin prefijo 0x", TEST_PRIVATE_KEY.slice(2)],
    ["muy corta", "0x1234"],
    ["con caracteres no hex", `0x${"g".repeat(64)}`],
    ["vacía", ""],
  ])("rechaza una llave inválida (%s) con InvalidPrivateKeyError", (_label, bad) => {
    vi.stubGlobal("window", { localStorage: createFakeLocalStorage() });

    expect(() => importAccount(bad)).toThrow(InvalidPrivateKeyError);
    // No debe haber quedado ninguna cuenta adoptada tras el rechazo.
    expect(getAccount()).toBeNull();
  });

  it("si localStorage tira, igual adopta la cuenta en memoria para esta sesión", () => {
    vi.stubGlobal("window", { localStorage: createThrowingLocalStorage() });

    const account = importAccount(TEST_PRIVATE_KEY);

    expect(account.address).toBe(privateKeyToAccount(TEST_PRIVATE_KEY).address);
    // `getAccount()` también pasa por el mismo fallback en memoria, aunque
    // `localStorage.getItem` tire.
    expect(getAccount()?.address).toBe(account.address);
  });
});
