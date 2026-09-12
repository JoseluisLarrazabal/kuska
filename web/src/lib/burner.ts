import {
  generatePrivateKey,
  privateKeyToAccount,
  type PrivateKeyAccount,
} from "viem/accounts";
import type { Hex } from "viem";

const STORAGE_KEY = "kuska.burner.v1";
const BACKUP_STORAGE_KEY = "kuska.burner.backup.v1";
const PRIVATE_KEY_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * Error tipado para una llave privada inválida al importar. Se usa en vez de
 * dejar que `privateKeyToAccount` tire su propio error interno de viem, para
 * dar un mensaje claro y estable en la UI (regla: nunca adivinar).
 */
export class InvalidPrivateKeyError extends Error {
  constructor() {
    super(
      "Llave privada inválida: debe ser hex de 32 bytes con prefijo 0x (0x + 64 caracteres hexadecimales).",
    );
    this.name = "InvalidPrivateKeyError";
  }
}

// Fallback en memoria: si `localStorage` no está disponible (modo privado,
// storage bloqueado, cuota excedida, SSR), la llave burner se mantiene solo
// en memoria de este módulo para que la sesión actual siga funcionando, en
// vez de romper. `isPersistent()` expone si la llave ACTUAL está realmente
// guardada en `localStorage`: si devuelve `false`, el front debe avisar antes
// de fondear ("esta llave no se guardó, no la fondees / no cierres la
// pestaña"), porque se pierde al recargar o cerrar la pestaña.
let inMemoryKey: Hex | null = null;
let inMemoryPersisted = false;

// Mismo patrón de storage + fallback en memoria que la llave principal, pero
// para el slot de backup (ver `importAccount`): guarda la llave que este
// dispositivo tenía ANTES de un `importAccount` que la reemplazó, para poder
// ofrecer "Restaurar la llave anterior" sin haberla perdido.
let inMemoryBackupKey: Hex | null = null;

function readStoredKey(): Hex | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw || !PRIVATE_KEY_RE.test(raw)) return null;
    return raw as Hex;
  } catch {
    // localStorage no disponible (modo privado, SSR, cuota, etc.)
    return null;
  }
}

/** Intenta persistir `key`; devuelve si realmente quedó guardada. */
function writeStoredKey(key: Hex): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, key);
    return true;
  } catch {
    // si no se puede persistir, la cuenta igual se devuelve para esta sesión
    // (ver fallback en memoria arriba)
    return false;
  }
}

function readBackupKey(): Hex | null {
  try {
    const raw = window.localStorage.getItem(BACKUP_STORAGE_KEY);
    if (!raw || !PRIVATE_KEY_RE.test(raw)) return null;
    return raw as Hex;
  } catch {
    return null;
  }
}

/** Intenta persistir `key` en el slot de backup; igual fallback en memoria que la llave principal si `localStorage` tira. */
function writeBackupKey(key: Hex): void {
  inMemoryBackupKey = key;
  try {
    window.localStorage.setItem(BACKUP_STORAGE_KEY, key);
  } catch {
    // se mantiene en memoria (arriba) para esta sesión
  }
}

function clearBackupKey(): void {
  try {
    window.localStorage.removeItem(BACKUP_STORAGE_KEY);
  } catch {
    // no-op
  }
  inMemoryBackupKey = null;
}

/**
 * Devuelve la cuenta burner ya existente (en `localStorage`, o en memoria si
 * `localStorage` no estuvo disponible cuando se creó), o `null` si todavía no
 * se creó ninguna. Usar esto (nunca `getOrCreateAccount`) en páginas donde
 * crear una llave en silencio sería sorpresivo, como la página de entrega.
 */
export function getAccount(): PrivateKeyAccount | null {
  const stored = readStoredKey();
  if (stored) {
    inMemoryKey = stored;
    inMemoryPersisted = true;
    return privateKeyToAccount(stored);
  }
  if (inMemoryKey) {
    return privateKeyToAccount(inMemoryKey);
  }
  return null;
}

/**
 * Devuelve la cuenta burner, generándola y persistiéndola si no existe
 * todavía. Llamar solo desde un flujo donde crear una llave nueva es
 * esperado y explícito (p. ej. "Comprar" o "Vender"), nunca implícitamente.
 * La cuenta resultante expone `signTypedData` (viem `PrivateKeyAccount`)
 * para firmar los mensajes EIP-712 de `lib/escrow/typedData.ts`.
 *
 * Si `localStorage` no está disponible, la llave se mantiene en memoria
 * (la sesión sigue funcionando) — llamar a `isPersistent()` para saber si
 * hace falta avisar que la llave no sobrevive a un recargo/cierre de pestaña.
 */
export function getOrCreateAccount(): PrivateKeyAccount {
  const existing = getAccount();
  if (existing) return existing;

  const key = generatePrivateKey();
  inMemoryKey = key;
  inMemoryPersisted = writeStoredKey(key);
  return privateKeyToAccount(key);
}

/**
 * Valida el formato de una llave privada y devuelve la cuenta que resultaría
 * de importarla, SIN persistirla ni reemplazar la cuenta actual. Pensado
 * para previsualizar (mostrar la dirección resultante, detectar si ya es la
 * cuenta actual, decidir si hace falta confirmar un reemplazo destructivo)
 * antes de llamar a `importAccount`. Tira `InvalidPrivateKeyError` con el
 * mismo criterio que `importAccount`.
 */
export function previewAccountFromKey(privateKey: string): PrivateKeyAccount {
  const trimmed = privateKey.trim();
  if (!PRIVATE_KEY_RE.test(trimmed)) {
    throw new InvalidPrivateKeyError();
  }
  return privateKeyToAccount(trimmed as Hex);
}

/**
 * Importa una llave privada A MANO y la adopta como la cuenta burner de este
 * dispositivo, persistiéndola por el mismo camino que `getOrCreateAccount`
 * (misma `STORAGE_KEY`, mismo fallback en memoria). Pensado para la demo en
 * vivo: el dispositivo del vendedor pega acá la llave del `VITE_DEMO_SELLER`
 * para poder firmar `claimDelivery`/`cancel` con esa identidad — la llave
 * privada NUNCA vive en el bundle ni en una env `VITE_*` (es pública).
 *
 * Si ya había una cuenta distinta en este dispositivo, esa llave anterior se
 * guarda primero en un slot de backup (`getBackupAccount`/
 * `restoreBackupAccount`) en vez de perderse: sin esto, importar la llave del
 * vendedor de demo sobre un dispositivo que ya venía usándose como comprador
 * dejaba sin firmante a los pedidos armados desde ahí, con su mUSD
 * inalcanzable.
 *
 * Valida el formato antes de usarlo; tira `InvalidPrivateKeyError` si no es
 * un hex de 32 bytes con prefijo 0x. Igual que `getOrCreateAccount`, queda
 * reflejada por `isPersistent()`: si `localStorage` no la pudo guardar, el
 * front debe avisar antes de fondear con esta identidad importada.
 */
export function importAccount(privateKey: string): PrivateKeyAccount {
  const trimmed = privateKey.trim();
  if (!PRIVATE_KEY_RE.test(trimmed)) {
    throw new InvalidPrivateKeyError();
  }
  const key = trimmed as Hex;

  const existingKey = readStoredKey() ?? inMemoryKey;
  if (existingKey && existingKey.toLowerCase() !== key.toLowerCase()) {
    writeBackupKey(existingKey);
  }

  inMemoryKey = key;
  inMemoryPersisted = writeStoredKey(key);
  return privateKeyToAccount(key);
}

/**
 * Cuenta guardada en el slot de backup (la que este dispositivo tenía antes
 * del último `importAccount` que la reemplazó por una distinta), o `null` si
 * no hay ninguna. Para mostrar "Restaurar la llave anterior" sin exponer la
 * llave privada.
 */
export function getBackupAccount(): PrivateKeyAccount | null {
  const stored = readBackupKey();
  if (stored) return privateKeyToAccount(stored);
  if (inMemoryBackupKey) return privateKeyToAccount(inMemoryBackupKey);
  return null;
}

/**
 * Restaura la cuenta del slot de backup como la cuenta activa de este
 * dispositivo y limpia el backup (un solo nivel: no hay pila de backups).
 * Devuelve `null` sin hacer nada si no había ninguna backup guardada.
 */
export function restoreBackupAccount(): PrivateKeyAccount | null {
  const backup = readBackupKey() ?? inMemoryBackupKey;
  if (!backup) return null;
  inMemoryKey = backup;
  inMemoryPersisted = writeStoredKey(backup);
  clearBackupKey();
  return privateKeyToAccount(backup);
}

/**
 * ¿La llave burner actual quedó guardada en `localStorage`? `false` significa
 * que solo vive en memoria de este módulo (localStorage bloqueado/cuota/modo
 * privado): se pierde al recargar o cerrar la pestaña, así que el front debe
 * avisarlo antes de fondear la cuenta.
 *
 * No alcanza con devolver `inMemoryPersisted`: esa bandera solo se setea
 * dentro de `getAccount()`/`getOrCreateAccount()`/`importAccount()`, así que
 * un componente que llame `isPersistent()` ANTES de leer la cuenta (el caso
 * "avisar antes de fondear" de arriba) recibía siempre `false`, aunque ya
 * hubiera una llave válida en `localStorage` de una sesión anterior. Se
 * relee `localStorage` directamente y, si no hay nada ahí, se cae a la
 * bandera en memoria (para cuando la llave actual es una que se generó o
 * importó en esta sesión sin poder persistirse).
 */
export function isPersistent(): boolean {
  return readStoredKey() !== null || inMemoryPersisted;
}

/** Borra la cuenta burner persistida y su backup (p. ej. para "olvidar" la demo). */
export function clearAccount(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // no-op
  }
  inMemoryKey = null;
  inMemoryPersisted = false;
  clearBackupKey();
}
