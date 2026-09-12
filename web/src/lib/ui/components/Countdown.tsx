import { useEffect, useState } from "react";
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

/** Cuenta regresiva en vivo (mm:ss), región `aria-live` para lectores de pantalla. */
export function Countdown({ deadline, className = "", label, size = "sm" }: CountdownProps) {
  const deadlineSeconds = Number(deadline);
  const [remaining, setRemaining] = useState(() => deadlineSeconds - nowSeconds());

  useEffect(() => {
    const tick = () => setRemaining(deadlineSeconds - nowSeconds());
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [deadlineSeconds]);

  const expired = remaining <= 0;
  const valueClasses = expired
    ? "text-sm text-verde-mut"
    : size === "lg"
      ? "text-[28px] font-bold text-terracota"
      : "text-sm font-semibold text-terracota";

  return (
    <span
      className={`inline-flex items-center justify-center gap-1.5 font-mono tabular-nums ${valueClasses} ${className}`}
      aria-live="polite"
    >
      {label ? <span className="text-sm font-sans font-normal text-verde-mut">{label}</span> : null}
      {expired ? "Vencida" : formatCountdown(remaining)}
    </span>
  );
}
