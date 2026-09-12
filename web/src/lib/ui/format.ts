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

const AMOUNT_INPUT_RE = /^\d+(\.\d{1,6})?$/;

/**
 * Valida y convierte un monto ingresado por el usuario a unidades mínimas,
 * con el MISMO parser (`parseUnits`) que se usa al enviar — antes la
 * validación usaba `Number(...)` y el submit `parseUnits(...)`, dos parsers
 * que no siempre concuerdan: `"1e3"` pasa `Number` pero `parseUnits` no
 * acepta notación científica; `"0.0000001"` pasa `Number` pero redondea a
 * `0n` en unidades mínimas (el contrato revierte `InvalidAmount`); `" 10 "`
 * pasa `Number` (que recorta espacios) pero `parseUnits` no los recorta.
 * Acá se recorta primero, se exige un decimal estricto (sin notación
 * científica, sin más de `DEMO_USD_DECIMALS` dígitos decimales) y se exige
 * que el resultado en unidades mínimas sea mayor a 0. Devuelve `undefined`
 * si el input no es un monto válido.
 */
export function parseAmountInput(input: string): bigint | undefined {
  const trimmed = input.trim();
  if (!AMOUNT_INPUT_RE.test(trimmed)) return undefined;
  const units = parseUnits(trimmed, DEMO_USD_DECIMALS);
  return units > 0n ? units : undefined;
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
