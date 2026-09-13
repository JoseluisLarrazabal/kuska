import { useEffect, useRef, useState } from "react";
import { formatCountdown, nowSeconds } from "../format";

interface CountdownProps {
  /** Segundos Unix del deadline. */
  deadline: bigint;
  className?: string;
  /** Texto antes del reloj, p. ej. "Ventana de disputa:". */
  label?: string;
  /** `lg` agranda el valor del reloj (pantalla QR del vendedor). Default: tamaño actual. */
  size?: "sm" | "lg";
}

/** A partir de acá el anuncio para lectores de pantalla se throttlea (ver más abajo). */
const HOUR_RANGE_SECONDS = 3600;
/** Bajo este umbral, el anuncio vuelve a ser por segundo (el countdown ya importa segundo a segundo). */
const FINAL_MINUTE_SECONDS = 60;
/** Entre `FINAL_MINUTE_SECONDS` y `HOUR_RANGE_SECONDS`, cada cuántos segundos se re-anuncia. */
const SUB_HOUR_ANNOUNCE_INTERVAL_SECONDS = 10;

/** `${n} <singular>` si n === 1, si no `${n} <plural>` — evita "1 horas"/"1 minutos"/"1 segundos". */
function unit(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** Texto con unidades ("23 horas 59 minutos restantes" / "9 minutos 45 segundos restantes") para el lector de pantalla — los dígitos crudos de `formatCountdown` no son accesibles. */
function accessibleRemainingText(remaining: number): string {
  if (remaining >= HOUR_RANGE_SECONDS) {
    const h = Math.floor(remaining / 3600);
    const m = Math.floor((remaining % 3600) / 60);
    return `${unit(h, "hora", "horas")} ${unit(m, "minuto", "minutos")} restantes`;
  }
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  return `${unit(m, "minuto", "minutos")} ${unit(s, "segundo", "segundos")} restantes`;
}

/**
 * Cuenta regresiva en vivo. Texto visible: `mm:ss` bajo 1h, `Nh Nmin` desde 1h
 * (`formatCountdown`) — se actualiza cada segundo en los tres casos. Anuncio
 * para lectores de pantalla (región oculta `aria-live="polite"`, separada del
 * texto visible que queda `aria-hidden`): con unidades en vez de dígitos
 * crudos, y throttleado — sin esto, una ventana de disputa de 24h (mainnet)
 * o un delivery en vivo de 30 min (`LIVE_DELIVERY_SECONDS` en Buy.tsx) le
 * leían un número nuevo al lector de pantalla cada segundo sin parar.
 * Throttle por rango: >= 1h, una vez por minuto; entre 1h y el último minuto,
 * una vez cada `SUB_HOUR_ANNOUNCE_INTERVAL_SECONDS`; en el último minuto,
 * por segundo (ahí sí importa la precisión).
 */
export function Countdown({ deadline, className = "", label, size = "sm" }: CountdownProps) {
  const deadlineSeconds = Number(deadline);
  const [remaining, setRemaining] = useState(() => deadlineSeconds - nowSeconds());
  const [announced, setAnnounced] = useState(remaining);
  const lastAnnouncedBucketRef = useRef<number | null>(null);

  useEffect(() => {
    const tick = () => setRemaining(deadlineSeconds - nowSeconds());
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [deadlineSeconds]);

  useEffect(() => {
    if (remaining >= HOUR_RANGE_SECONDS) {
      const minuteBucket = Math.floor(remaining / 60);
      if (lastAnnouncedBucketRef.current !== minuteBucket) {
        lastAnnouncedBucketRef.current = minuteBucket;
        setAnnounced(remaining);
      }
    } else if (remaining >= FINAL_MINUTE_SECONDS) {
      const bucket = Math.floor(remaining / SUB_HOUR_ANNOUNCE_INTERVAL_SECONDS);
      if (lastAnnouncedBucketRef.current !== bucket) {
        lastAnnouncedBucketRef.current = bucket;
        setAnnounced(remaining);
      }
    } else {
      lastAnnouncedBucketRef.current = null;
      setAnnounced(remaining);
    }
  }, [remaining]);

  const expired = remaining <= 0;
  const valueClasses = expired
    ? "text-sm text-verde-mut"
    : size === "lg"
      ? "text-[28px] font-bold text-terracota"
      : "text-sm font-semibold text-terracota";

  return (
    <span
      className={`inline-flex items-center justify-center gap-1.5 font-mono tabular-nums ${valueClasses} ${className}`}
    >
      {label ? <span className="text-sm font-sans font-normal text-verde-mut">{label}</span> : null}
      <span aria-hidden="true">{expired ? "Vencida" : formatCountdown(remaining)}</span>
      <span className="sr-only" aria-live="polite">
        {expired ? "Vencida" : accessibleRemainingText(announced)}
      </span>
    </span>
  );
}
