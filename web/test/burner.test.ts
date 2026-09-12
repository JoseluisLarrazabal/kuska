import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  clearAccount,
  getAccount,
  getKeyHistory,
  importAccount,
  InvalidPrivateKeyError,
  previewAccountFromKey,
  restorePreviousAccount,
} from "../src/lib/burner";

// Llaves descartables generadas al vuelo para el test (nunca una llave real
// ni un literal hardcodeado en el repo).
const TEST_PRIVATE_KEY = generatePrivateKey();
const OTHER_PRIVATE_KEY = generatePrivateKey();
const THIRD_PRIVATE_KEY = generatePrivateKey();

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

describe("previewAccountFromKey", () => {
  beforeEach(() => {
    clearAccount();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("devuelve la cuenta sin persistir nada", () => {
    // Sin `window` disponible (entorno node de vitest): si intentara tocar
    // storage, tiraría. No debería.
    const preview = previewAccountFromKey(TEST_PRIVATE_KEY);
    expect(preview.address).toBe(privateKeyToAccount(TEST_PRIVATE_KEY).address);
    expect(getAccount()).toBeNull();
  });

  it("rechaza una llave inválida con InvalidPrivateKeyError", () => {
    expect(() => previewAccountFromKey("0x1234")).toThrow(InvalidPrivateKeyError);
  });
});

describe("importAccount — historial de llaves anteriores", () => {
  beforeEach(() => {
    clearAccount();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("no hay historial antes de importar nada", () => {
    vi.stubGlobal("window", { localStorage: createFakeLocalStorage() });
    expect(getKeyHistory()).toEqual([]);
  });

  it("al importar una llave distinta, la anterior queda en el historial", () => {
    vi.stubGlobal("window", { localStorage: createFakeLocalStorage() });

    importAccount(TEST_PRIVATE_KEY);
    expect(getKeyHistory()).toEqual([]); // todavía no había nada que respaldar

    importAccount(OTHER_PRIVATE_KEY);

    // La cuenta activa ahora es la nueva…
    expect(getAccount()?.address).toBe(privateKeyToAccount(OTHER_PRIVATE_KEY).address);
    // …y la anterior quedó en el historial, no perdida.
    expect(getKeyHistory()).toEqual([privateKeyToAccount(TEST_PRIVATE_KEY).address]);
  });

  it("importar la MISMA llave (mismo address) no agrega una entrada al historial", () => {
    vi.stubGlobal("window", { localStorage: createFakeLocalStorage() });

    importAccount(TEST_PRIVATE_KEY);
    importAccount(TEST_PRIVATE_KEY.toUpperCase().replace("0X", "0x") as `0x${string}`);

    expect(getKeyHistory()).toEqual([]);
  });

  it("importar A→B→C y restaurar A recupera la llave original sin perder B (regresión: un solo slot de backup la perdía)", () => {
    vi.stubGlobal("window", { localStorage: createFakeLocalStorage() });

    importAccount(TEST_PRIVATE_KEY); // A activa
    importAccount(OTHER_PRIVATE_KEY); // B activa, A → historial
    importAccount(THIRD_PRIVATE_KEY); // C activa, B → historial

    const addrA = privateKeyToAccount(TEST_PRIVATE_KEY).address;
    const addrB = privateKeyToAccount(OTHER_PRIVATE_KEY).address;
    const addrC = privateKeyToAccount(THIRD_PRIVATE_KEY).address;

    // Con el diseño anterior (un solo slot), A ya estaría perdida acá.
    expect(getKeyHistory()).toEqual([addrB, addrA]);

    const restored = restorePreviousAccount(addrA);

    expect(restored?.address).toBe(addrA);
    expect(getAccount()?.address).toBe(addrA);
    // C (la que estaba activa) pasa al historial en vez de perderse: es un
    // swap, no un descarte.
    expect(getKeyHistory()).toEqual([addrC, addrB]);
  });

  it("restorePreviousAccount() no hace nada y devuelve null si la dirección no está en el historial", () => {
    vi.stubGlobal("window", { localStorage: createFakeLocalStorage() });

    importAccount(TEST_PRIVATE_KEY);
    const restored = restorePreviousAccount(privateKeyToAccount(OTHER_PRIVATE_KEY).address);

    expect(restored).toBeNull();
    expect(getAccount()?.address).toBe(privateKeyToAccount(TEST_PRIVATE_KEY).address);
  });

  it("el historial queda acotado a las últimas 5 llaves distintas", () => {
    vi.stubGlobal("window", { localStorage: createFakeLocalStorage() });

    const keys = Array.from({ length: 7 }, () => generatePrivateKey());
    for (const key of keys) {
      importAccount(key);
    }

    const history = getKeyHistory();
    expect(history).toHaveLength(5);
    // Más reciente primero: las últimas 5 anteriores a la activa (índices 5..1 de `keys`, la
    // 6ta importada activa quedó afuera del historial y la 0 (la más vieja) se cayó por la cota).
    const expectedOrder = [keys[5], keys[4], keys[3], keys[2], keys[1]];
    expect(history).toEqual(expectedOrder.map((k) => privateKeyToAccount(k!).address));
  });

  it("si localStorage tira, el historial igual queda disponible en memoria para esta sesión", () => {
    vi.stubGlobal("window", { localStorage: createThrowingLocalStorage() });

    importAccount(TEST_PRIVATE_KEY);
    importAccount(OTHER_PRIVATE_KEY);

    const addrA = privateKeyToAccount(TEST_PRIVATE_KEY).address;
    expect(getKeyHistory()).toEqual([addrA]);

    const restored = restorePreviousAccount(addrA);
    expect(restored?.address).toBe(addrA);
    expect(getAccount()?.address).toBe(addrA);
  });
});
