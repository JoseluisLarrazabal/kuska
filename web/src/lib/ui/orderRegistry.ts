import type { Hex } from "viem";

/**
 * Registro local (bookmark) de `orderRef` conocidos por este navegador: no
 * hay forma de "listar los deals de un vendedor" en el contrato sin indexar
 * eventos, y el brief pide leer estado on-chain solo con `getDeal`. En el
 * flujo real cada parte se entera de un pedido por el link que le comparten
 * (`/pedido/:ref`); esto solo recuerda esos links en este dispositivo para no
 * tener que volver a pegarlos.
 */
const STORAGE_KEY = "kuska.orders.v1";

export type TrackedOrderRole = "buyer" | "seller" | "demo";

export interface TrackedOrder {
  ref: Hex;
  item?: string;
  role?: TrackedOrderRole;
  addedAt: number;
}

function readAll(): TrackedOrder[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TrackedOrder[]) : [];
  } catch {
    return [];
  }
}

function writeAll(orders: TrackedOrder[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
  } catch {
    // sin persistencia: el pedido sigue siendo accesible por su link directo
  }
}

export function listTrackedOrders(): TrackedOrder[] {
  return readAll().sort((a, b) => b.addedAt - a.addedAt);
}

/**
 * Busca un pedido trackeado por `ref`, comparando sin distinguir
 * mayúsculas/minúsculas: los parsers (`parseOrderRefFromText`, el `:ref` de
 * la ruta) aceptan cualquier capitalización hex, así que un mismo pedido
 * podía guardarse con una capitalización y buscarse con otra — sin esto la
 * búsqueda fallaba en silencio y `Order.tsx` mostraba el pedido sin el
 * `item` que este dispositivo ya había visto antes.
 */
export function findTrackedOrder(ref: Hex): TrackedOrder | undefined {
  const target = ref.toLowerCase();
  return readAll().find((o) => o.ref.toLowerCase() === target);
}

export function trackOrder(
  ref: Hex,
  extra: Partial<Pick<TrackedOrder, "item" | "role">> = {},
): void {
  const orders = readAll();
  const target = ref.toLowerCase();
  const existingIndex = orders.findIndex((o) => o.ref.toLowerCase() === target);
  if (existingIndex >= 0) {
    const existing = orders[existingIndex];
    if (!existing) return;
    orders[existingIndex] = { ...existing, ...extra };
    writeAll(orders);
    return;
  }
  orders.push({ ref, addedAt: Date.now(), ...extra });
  writeAll(orders);
}

export function untrackOrder(ref: Hex): void {
  const target = ref.toLowerCase();
  writeAll(readAll().filter((o) => o.ref.toLowerCase() !== target));
}
