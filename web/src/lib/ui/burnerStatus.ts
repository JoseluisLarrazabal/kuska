/**
 * `lib/burner.ts` no expone todavía un `isPersistent()` EN ESTA RAMA (otro
 * carril lo está agregando en paralelo en `feat/web-scaffold`, commit
 * `aab5915` y posteriores — no se puede tocar `burner.ts` acá sin generar
 * conflicto de rebase). Mientras tanto, esta es una heurística propia y
 * equivalente: intenta escribir y releer una clave de prueba en
 * `localStorage`, igual que `burner.ts` hace internamente para la llave real.
 *
 * TODO(rebase): tras mergear `feat/web-scaffold` y rebasar esta rama encima,
 * borrar esta implementación local y reemplazar este módulo por un re-export
 * delgado: `export { isPersistent as isBurnerPersistent } from "../burner";`.
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
