import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  clearAccount,
  getAccount,
  getBackupAccount,
  importAccount,
  InvalidPrivateKeyError,
  previewAccountFromKey,
  restoreBackupAccount,
} from "../src/lib/burner";

// Llaves descartables generadas al vuelo para el test (nunca una llave real
// ni un literal hardcodeado en el repo).
const TEST_PRIVATE_KEY = generatePrivateKey();
const OTHER_PRIVATE_KEY = generatePrivateKey();

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

describe("importAccount — backup de la llave anterior", () => {
  beforeEach(() => {
    clearAccount();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("no hay backup antes de importar nada", () => {
    vi.stubGlobal("window", { localStorage: createFakeLocalStorage() });
    expect(getBackupAccount()).toBeNull();
  });

  it("al importar una llave distinta, la anterior queda en el slot de backup", () => {
    vi.stubGlobal("window", { localStorage: createFakeLocalStorage() });

    importAccount(TEST_PRIVATE_KEY);
    expect(getBackupAccount()).toBeNull(); // todavía no había nada que respaldar

    importAccount(OTHER_PRIVATE_KEY);

    // La cuenta activa ahora es la nueva…
    expect(getAccount()?.address).toBe(privateKeyToAccount(OTHER_PRIVATE_KEY).address);
    // …y la anterior quedó respaldada, no perdida.
    expect(getBackupAccount()?.address).toBe(privateKeyToAccount(TEST_PRIVATE_KEY).address);
  });

  it("importar la MISMA llave (mismo address) no crea un backup", () => {
    vi.stubGlobal("window", { localStorage: createFakeLocalStorage() });

    importAccount(TEST_PRIVATE_KEY);
    importAccount(TEST_PRIVATE_KEY.toUpperCase().replace("0X", "0x") as `0x${string}`);

    expect(getBackupAccount()).toBeNull();
  });

  it("restoreBackupAccount() restaura la identidad anterior y vacía el backup", () => {
    vi.stubGlobal("window", { localStorage: createFakeLocalStorage() });

    importAccount(TEST_PRIVATE_KEY);
    importAccount(OTHER_PRIVATE_KEY);
    expect(getAccount()?.address).toBe(privateKeyToAccount(OTHER_PRIVATE_KEY).address);

    const restored = restoreBackupAccount();

    expect(restored?.address).toBe(privateKeyToAccount(TEST_PRIVATE_KEY).address);
    expect(getAccount()?.address).toBe(privateKeyToAccount(TEST_PRIVATE_KEY).address);
    expect(getBackupAccount()).toBeNull(); // un solo nivel: no queda pila de backups
  });

  it("restoreBackupAccount() no hace nada y devuelve null si no hay backup", () => {
    vi.stubGlobal("window", { localStorage: createFakeLocalStorage() });

    importAccount(TEST_PRIVATE_KEY);
    const restored = restoreBackupAccount();

    expect(restored).toBeNull();
    expect(getAccount()?.address).toBe(privateKeyToAccount(TEST_PRIVATE_KEY).address);
  });

  it("si localStorage tira, el backup igual queda disponible en memoria para esta sesión", () => {
    vi.stubGlobal("window", { localStorage: createThrowingLocalStorage() });

    importAccount(TEST_PRIVATE_KEY);
    importAccount(OTHER_PRIVATE_KEY);

    expect(getBackupAccount()?.address).toBe(privateKeyToAccount(TEST_PRIVATE_KEY).address);

    const restored = restoreBackupAccount();
    expect(restored?.address).toBe(privateKeyToAccount(TEST_PRIVATE_KEY).address);
    expect(getAccount()?.address).toBe(privateKeyToAccount(TEST_PRIVATE_KEY).address);
  });
});
