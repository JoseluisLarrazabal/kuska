/**
 * IP del cliente a partir de los headers de una request HTTP. Preferimos
 * `x-forwarded-for` (primer valor: el cliente original detrás de proxies o
 * de la red de Vercel) con fallback a `x-real-ip`.
 *
 * Esto se resuelve siempre en el BORDE (`web/api/*.ts`, `web/server/devServer.ts`),
 * nunca dentro de un handler "puro" como `handleFaucet`: así la lógica de
 * negocio sigue siendo testeable con un `clientIp` de string plano, sin tener
 * que construir un `Request`/`Headers` real en cada test.
 */
export function getClientIp(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = headers.get("x-real-ip");
  if (realIp?.trim()) return realIp.trim();

  return "unknown";
}
