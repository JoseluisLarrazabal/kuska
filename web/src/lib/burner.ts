import {
  generatePrivateKey,
  privateKeyToAccount,
  type PrivateKeyAccount,
} from "viem/accounts";
import type { Hex } from "viem";

const STORAGE_KEY = "kuska.burner.v1";
const PRIVATE_KEY_RE = /^0x[0-9a-fA-F]{64}$/;

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

function writeStoredKey(key: Hex): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, key);
  } catch {
    // si no se puede persistir, la cuenta igual se devuelve para esta sesión
  }
}

/**
 * Devuelve la cuenta burner ya existente en `localStorage`, o `null` si
 * todavía no se creó ninguna. Usar esto (nunca `getOrCreateAccount`) en
 * páginas donde crear una llave en silencio sería sorpresivo, como la
 * página de entrega.
 */
export function getAccount(): PrivateKeyAccount | null {
  const key = readStoredKey();
  return key ? privateKeyToAccount(key) : null;
}

/**
 * Devuelve la cuenta burner, generándola y persistiéndola si no existe
 * todavía. Llamar solo desde un flujo donde crear una llave nueva es
 * esperado y explícito (p. ej. "Comprar" o "Vender"), nunca implícitamente.
 * La cuenta resultante expone `signTypedData` (viem `PrivateKeyAccount`)
 * para firmar los mensajes EIP-712 de `lib/escrow/typedData.ts`.
 */
export function getOrCreateAccount(): PrivateKeyAccount {
  const existing = getAccount();
  if (existing) return existing;

  const key = generatePrivateKey();
  writeStoredKey(key);
  return privateKeyToAccount(key);
}

/** Borra la cuenta burner persistida (p. ej. para "olvidar" la demo). */
export function clearAccount(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // no-op
  }
}
