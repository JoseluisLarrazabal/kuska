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

/** Texto con unidades ("23 horas 59 minutos restantes" / "9 minutos 45 segundos restantes") para el lector de pantalla — los dígitos crudos de `formatCountdown` no son accesibles. */
function accessibleRemainingText(remaining: number): string {
  if (remaining >= HOUR_RANGE_SECONDS) {
    const h = Math.floor(remaining / 3600);
    const m = Math.floor((remaining % 3600) / 60);
    return `${h} horas ${m} minutos restantes`;
  }
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  return `${m} minutos ${s} segundos restantes`;
}

/**
 * Cuenta regresiva en vivo. Texto visible: `mm:ss` bajo 1h, `Nh Nmin` desde 1h
 * (`formatCountdown`) — se actualiza cada segundo en los dos casos. Anuncio
 * para lectores de pantalla (región oculta `aria-live="polite"`, separada del
 * texto visible que queda `aria-hidden`): con unidades en vez de dígitos
 * crudos, y throttleado a una vez por minuto cuando falta 1h o más — sin
 * esto, una ventana de disputa de 24h (mainnet) le leía un número nuevo al
 * lector de pantalla cada segundo durante 24 horas seguidas.
 */
export function Countdown({ deadline, className = "", label, size = "sm" }: CountdownProps) {
  const deadlineSeconds = Number(deadline);
  const [remaining, setRemaining] = useState(() => deadlineSeconds - nowSeconds());
  const [announced, setAnnounced] = useState(remaining);
  const lastAnnouncedMinuteRef = useRef<number | null>(null);

  useEffect(() => {
    const tick = () => setRemaining(deadlineSeconds - nowSeconds());
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [deadlineSeconds]);

  useEffect(() => {
    if (remaining >= HOUR_RANGE_SECONDS) {
      const minuteBucket = Math.floor(remaining / 60);
      if (lastAnnouncedMinuteRef.current !== minuteBucket) {
        lastAnnouncedMinuteRef.current = minuteBucket;
        setAnnounced(remaining);
      }
    } else {
      lastAnnouncedMinuteRef.current = null;
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
