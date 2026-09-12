import {
  generatePrivateKey,
  privateKeyToAccount,
  type PrivateKeyAccount,
} from "viem/accounts";
import type { Hex } from "viem";

const STORAGE_KEY = "kuska.burner.v1";
const PRIVATE_KEY_RE = /^0x[0-9a-fA-F]{64}$/;

// Fallback en memoria: si `localStorage` no está disponible (modo privado,
// storage bloqueado, cuota excedida, SSR), la llave burner se mantiene solo
// en memoria de este módulo para que la sesión actual siga funcionando, en
// vez de romper. `isPersistent()` expone si la llave ACTUAL está realmente
// guardada en `localStorage`: si devuelve `false`, el front debe avisar antes
// de fondear ("esta llave no se guardó, no la fondees / no cierres la
// pestaña"), porque se pierde al recargar o cerrar la pestaña.
let inMemoryKey: Hex | null = null;
let inMemoryPersisted = false;

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
 * ¿La llave burner actual quedó guardada en `localStorage`? `false` significa
 * que solo vive en memoria de este módulo (localStorage bloqueado/cuota/modo
 * privado): se pierde al recargar o cerrar la pestaña, así que el front debe
 * avisarlo antes de fondear la cuenta.
 *
 * No alcanza con devolver `inMemoryPersisted`: esa bandera solo se setea
 * dentro de `getAccount()`/`getOrCreateAccount()`, así que un componente que
 * llame `isPersistent()` ANTES de leer la cuenta (el caso "avisar antes de
 * fondear" de arriba) recibía siempre `false`, aunque ya hubiera una llave
 * válida en `localStorage` de una sesión anterior. Se relee `localStorage`
 * directamente y, si no hay nada ahí, se cae a la bandera en memoria (para
 * cuando la llave actual es una que se generó en esta sesión sin poder
 * persistirse).
 */
export function isPersistent(): boolean {
  return readStoredKey() !== null || inMemoryPersisted;
}

/** Borra la cuenta burner persistida (p. ej. para "olvidar" la demo). */
export function clearAccount(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // no-op
  }
  inMemoryKey = null;
  inMemoryPersisted = false;
}
