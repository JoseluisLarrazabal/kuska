import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Regresión: Vercel Functions (Node.js runtime) trata un `export default` de
// `web/api/*.ts` como la firma legacy `(req, res) => void` e ignora
// silenciosamente el `Response` devuelto -- eso hace que TODO pedido cuelgue
// hasta el timeout (504 FUNCTION_INVOCATION_TIMEOUT), incluso con env
// configurada. La firma correcta para este proyecto (Web Fetch, named
// exports) es exportar funciones nombradas por método HTTP
// (`export function GET/POST(request: Request): Promise<Response>`) y NO
// tener ningún `export default` (ver
// https://vercel.com/docs/functions/functions-api-reference?framework=other).
// Este test falla si alguno de los tres módulos reintroduce un default
// export, y verifica que cada uno expone exactamente los métodos que sirve.
// ---------------------------------------------------------------------------

const modules: Array<{ path: string; expectedMethods: string[] }> = [
  { path: "../api/health.ts", expectedMethods: ["GET"] },
  { path: "../api/relay.ts", expectedMethods: ["POST"] },
  { path: "../api/faucet.ts", expectedMethods: ["POST"] },
];

describe("web/api/*.ts: firma Web-standard de named exports (sin default export)", () => {
  for (const { path, expectedMethods } of modules) {
    it(`${path} no tiene default export y expone exactamente ${expectedMethods.join(", ")} como función`, async () => {
      const mod: Record<string, unknown> = await import(path);

      expect("default" in mod, `${path} no debe tener export default`).toBe(false);

      for (const method of expectedMethods) {
        expect(typeof mod[method], `${path} debe exportar ${method} como función`).toBe(
          "function",
        );
      }

      // Ningún otro named export de método HTTP inesperado.
      const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"];
      const unexpectedMethods = HTTP_METHODS.filter(
        (m) => !expectedMethods.includes(m) && typeof mod[m] === "function",
      );
      expect(
        unexpectedMethods,
        `${path} expone métodos HTTP no esperados`,
      ).toEqual([]);
    });
  }
});
