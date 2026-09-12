import { formatUnits, parseUnits } from "viem";

/**
 * `MockUSD` y USDC.e usan 6 decimales (docs/escrow-interface.md §2). No hay
 * un lugar existente que exponga esta constante para la UI, así que se fija
 * acá (mismo valor documentado en la interfaz congelada).
 */
export const DEMO_USD_DECIMALS = 6;

/** Convierte un string ingresado por el usuario ("12.5") a unidades mínimas. */
export function parseDemoUsd(input: string): bigint {
  return parseUnits(input, DEMO_USD_DECIMALS);
}

/** Formatea unidades mínimas como monto legible con 2 decimales fijos. */
export function formatDemoUsd(amount: bigint): string {
  const full = formatUnits(amount, DEMO_USD_DECIMALS);
  const [intPart, decPart = ""] = full.split(".");
  const dec2 = (decPart + "00").slice(0, 2);
  return `${intPart}.${dec2}`;
}

/** Trunca una dirección/hash 0x… a `0x1234…abcd`. */
export function truncateHex(value: string, chars = 4): string {
  if (value.length <= chars * 2 + 3) return value;
  return `${value.slice(0, chars + 2)}…${value.slice(-chars)}`;
}

/** `mm:ss` para una cuenta regresiva; `00:00` si ya pasó. */
export function formatCountdown(secondsRemaining: number): string {
  const clamped = Math.max(0, Math.floor(secondsRemaining));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Hora local legible (para "disponible a las…"). */
export function formatUnixTime(unixSeconds: number | bigint): string {
  const ms = Number(unixSeconds) * 1000;
  return new Date(ms).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Segundos Unix actuales (para countdowns). */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
