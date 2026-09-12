import { useEffect, useState } from "react";
import { nowSeconds } from "./format";

/**
 * Segundos Unix que se actualiza cada `intervalMs` (1s por defecto).
 *
 * Las condiciones que dependen de `nowSeconds()` (p. ej. "¿ya venció el
 * plazo de entrega?") antes solo se re-evaluaban cuando el componente
 * re-renderizaba por otro motivo. Si el polling de `useDeal` devuelve el
 * mismo deal (mismo estado, misma data), React nunca vuelve a correr esas
 * comparaciones — una acción por tiempo (pedir reembolso, liberar pago,
 * cerrar la ventana de disputa) podía tardar minutos de más en aparecer o
 * desaparecer, o quedar ofrecida cuando ya iba a revertir en la cadena. Este
 * hook fuerza un re-render por tick para que esas condiciones se
 * re-evalúen en vivo, sin depender de que llegue otro dato.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => nowSeconds());

  useEffect(() => {
    const id = setInterval(() => setNow(nowSeconds()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
