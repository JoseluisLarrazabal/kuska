import { formatEther, formatUnits, parseUnits } from "viem";

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

/**
 * Mensaje cuando el saldo de mUSD del comprador no alcanza para pagar un
 * monto — usado por `Buy.tsx` antes de mandar `createOrder`: un comprador con
 * 0 mUSD que no apretó primero el botón manual del faucet se llevaba el mismo
 * `SIMULATION_REVERTED`/`UNKNOWN` opaco del relayer ("La operación no se pudo
 * completar"). El equivalente en `/demo` (`ensureDemoFunds.ts`) en vez de
 * avisar pide el faucet automáticamente porque ahí el "comprador" es una
 * cuenta de demo descartable; acá es la compra real, así que solo se bloquea
 * y se explica — no se le pide plata de mentira a la cuenta del usuario.
 *
 * `faucetAvailable` (default `true`, mantiene el mensaje histórico) indica si
 * el botón del faucet manual existe en esta red — en mainnet (chain 177)
 * `/api/faucet` no existe (`server/faucet.ts`), así que ahí no se puede
 * referenciar "el botón de arriba".
 */
export function insufficientFundsMessage(
  balance: bigint,
  amount: bigint,
  faucetAvailable = true,
): string {
  const base =
    `Tu cuenta no tiene mUSD suficientes para este pago (necesitás ${formatDemoUsd(amount)}, ` +
    `tenés ${formatDemoUsd(balance)}).`;
  return faucetAvailable
    ? `${base} Pedí mUSD de prueba con el botón de arriba.`
    : `${base} Pedile mUSD de prueba a quien esté operando la demo — en esta red no hay faucet automático.`;
}

/**
 * Redondea la representación decimal en string `intPart.decPart` a
 * `decimals` posiciones (redondeo "half up", como hace la gente), devuelta
 * como string sin ceros finales. Trabaja con `BigInt` sobre los dígitos
 * (nunca con `Number`) para no perder precisión con los 18 decimales de
 * wei — un `Number(formatEther(wei))` puede desbordar la precisión de un
 * float64 para balances grandes.
 */
function roundDecimalString(intPart: string, decPart: string, decimals: number): string {
  const safeDecimals = Math.max(0, decimals);
  const padded = decPart.padEnd(safeDecimals + 1, "0");
  const keep = padded.slice(0, safeDecimals);
  const roundUp = padded.charCodeAt(safeDecimals) >= "5".charCodeAt(0);
  const combinedDigits = `${intPart}${keep}`;
  const roundedDigits = (BigInt(combinedDigits) + (roundUp ? 1n : 0n))
    .toString()
    .padStart(combinedDigits.length, "0");
  const cut = roundedDigits.length - keep.length;
  const newInt = cut > 0 ? roundedDigits.slice(0, cut) : "0";
  const newDec = (cut > 0 ? roundedDigits.slice(cut) : roundedDigits.padStart(keep.length, "0")).replace(/0+$/, "");
  return newDec.length > 0 ? `${newInt}.${newDec}` : newInt;
}

/**
 * Formatea wei de HSK (18 decimales) a un monto legible: hasta
 * `sigDecimals` dígitos decimales *significativos* — contados desde el
 * primer dígito no-cero después del punto, no desde el punto mismo — sin
 * notación científica y sin redondear a "0" un saldo chico pero real (p. ej.
 * `0.000001 HSK` no se muestra como `0.0000`, que parecería saldo vacío).
 * Antes se mostraba `formatEther(hsk)` crudo (hasta 18 decimales, p. ej.
 * `0.099480426354340893 HSK`), ilegible en una fila de saldo de la demo.
 */
export function formatHskAmount(wei: bigint, sigDecimals = 4): string {
  if (wei === 0n) return "0";
  const negative = wei < 0n;
  const full = formatEther(negative ? -wei : wei);
  const [intPart = "0", decPart = ""] = full.split(".");

  const decimalsToKeep =
    intPart !== "0"
      ? sigDecimals
      : (() => {
          const firstNonZero = [...decPart].findIndex((d) => d !== "0");
          return firstNonZero === -1 ? sigDecimals : firstNonZero + sigDecimals;
        })();

  const rounded = roundDecimalString(intPart, decPart, decimalsToKeep);
  return negative && rounded !== "0" ? `-${rounded}` : rounded;
}

/** Trunca una dirección/hash 0x… a `0x1234…abcd`. */
export function truncateHex(value: string, chars = 4): string {
  if (value.length <= chars * 2 + 3) return value;
  return `${value.slice(0, chars + 2)}…${value.slice(-chars)}`;
}

/**
 * `mm:ss` para una cuenta regresiva bajo 1 hora; `Nh Nmin` (redondeado hacia
 * abajo al minuto) a partir de 1 hora — sin esto, la ventana de disputa de
 * mainnet (86400s = 24h) se mostraba como `1439:07`, ilegible. `00:00` si ya
 * pasó (clamp a 0, nunca negativo).
 */
export function formatCountdown(secondsRemaining: number): string {
  const clamped = Math.max(0, Math.floor(secondsRemaining));
  if (clamped >= 3600) {
    const h = Math.floor(clamped / 3600);
    const m = Math.floor((clamped % 3600) / 60);
    return `${h} h ${m} min`;
  }
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

/**
 * Hora local legible, con fecha si `unixSeconds` no cae en el mismo día que
 * `nowSeconds` (p. ej. "13 sept, 22:30" en vez de solo "22:30"). Un plazo de
 * entrega que vence otro día (no solo dentro de las próximas horas) se
 * mostraba antes solo con la hora, sin pista de qué día era.
 */
export function formatDeadline(unixSeconds: number | bigint, nowSeconds: number): string {
  const date = new Date(Number(unixSeconds) * 1000);
  const now = new Date(nowSeconds * 1000);
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const time = date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return time;
  const day = date.toLocaleDateString("es-AR", { day: "numeric", month: "short" });
  return `${day}, ${time}`;
}

/**
 * Termina una oración con un solo punto final, sin duplicarlo si `text` ya
 * termina en uno (p. ej. una hora en formato 12h que el `Intl` local
 * devuelve como "10:30 p. m.": concatenar un "." literal después daba
 * "p. m..").
 */
export function endSentence(text: string): string {
  return /\.\s*$/.test(text) ? text : `${text}.`;
}

/** Segundos Unix actuales (para countdowns). */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
