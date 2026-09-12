/**
 * `lib/burner.ts` no expone un `isPersistent()` (otro carril lo está tocando
 * en paralelo, regla dura del brief: no modificarlo). Esta es una heurística
 * propia y equivalente: intenta escribir y releer una clave de prueba en
 * `localStorage`, igual que `burner.ts` hace internamente para la llave real.
 * Desvío documentado en el reporte final.
 */
const PROBE_KEY = "kuska.burner.persistence-probe";

export function isBurnerPersistent(): boolean {
  try {
    window.localStorage.setItem(PROBE_KEY, "1");
    const ok = window.localStorage.getItem(PROBE_KEY) === "1";
    window.localStorage.removeItem(PROBE_KEY);
    return ok;
  } catch {
    return false;
  }
}
