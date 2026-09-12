import { useEffect, useState } from "react";
import { formatCountdown, nowSeconds } from "../format";

interface CountdownProps {
  /** Segundos Unix del deadline. */
  deadline: bigint;
  className?: string;
  /** Texto antes del reloj, p. ej. "Ventana de disputa:". */
  label?: string;
}

/** Cuenta regresiva en vivo (mm:ss), región `aria-live` para lectores de pantalla. */
export function Countdown({ deadline, className = "", label }: CountdownProps) {
  const deadlineSeconds = Number(deadline);
  const [remaining, setRemaining] = useState(() => deadlineSeconds - nowSeconds());

  useEffect(() => {
    const tick = () => setRemaining(deadlineSeconds - nowSeconds());
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [deadlineSeconds]);

  const expired = remaining <= 0;

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-sm tabular-nums ${
        expired ? "text-verde-mut" : "text-terracota font-semibold"
      } ${className}`}
      aria-live="polite"
    >
      {label ? <span className="font-sans font-normal text-verde-mut">{label}</span> : null}
      {expired ? "Vencida" : formatCountdown(remaining)}
    </span>
  );
}
