import http from "node:http";
import { POST as relayPost } from "../api/relay.js";
import { POST as faucetPost } from "../api/faucet.js";
import { GET as healthGet } from "../api/health.js";

const PORT = 8787;

type Handler = (request: Request) => Promise<Response>;

// Cada ruta expone solo los métodos que el módulo real exporta (mismo
// contrato que Vercel: named export por método HTTP). Un método sin entrada
// acá devuelve 405, igual que lo haría Vercel si no matchea ningún named
// export para ese método.
const routes: Record<string, Record<string, Handler>> = {
  "/api/relay": { POST: relayPost },
  "/api/faucet": { POST: faucetPost },
  "/api/health": { GET: healthGet },
};

async function toWebRequest(req: http.IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const bodyBuffer = Buffer.concat(chunks);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(", "));
  }
  // en prod (Vercel) `x-forwarded-for` ya viene seteado por la plataforma
  // (un proxy de confianza) y `getClientIp` confía en ese header. ACÁ no hay
  // ningún proxy delante: este `http.createServer` recibe la conexión TCP
  // directamente, así que cualquier caller puede mandar su propio
  // `x-forwarded-for`/`x-real-ip` y rotarlo en cada pedido para esquivar el
  // rate limit por IP del faucet (gastando gas del relayer sin límite). Por
  // eso acá SIEMPRE se descarta lo que mande el caller y se deriva la IP del
  // socket real — nunca se confía en un header que el propio cliente controla.
  headers.delete("x-forwarded-for");
  headers.delete("x-real-ip");
  if (req.socket.remoteAddress) {
    headers.set("x-forwarded-for", req.socket.remoteAddress);
  }

  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const method = req.method ?? "GET";

  return new Request(url, {
    method,
    headers,
    body: bodyBuffer.length > 0 ? bodyBuffer : undefined,
  });
}

async function writeWebResponse(res: http.ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}

const server = http.createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    const methodHandlers = routes[url.pathname];
    if (!methodHandlers) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    const method = req.method ?? "GET";
    const handler = methodHandlers[method];
    if (!handler) {
      res.statusCode = 405;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ code: "INVALID_REQUEST" }));
      return;
    }
    try {
      const request = await toWebRequest(req);
      const response = await handler(request);
      await writeWebResponse(res, response);
    } catch (err) {
      // nunca devolver `err.message` al cliente: puede filtrar detalles
      // internos (p. ej. la lista de issues de zod de una env var mal
      // configurada, incluyendo qué variables existen). Se loguea en el
      // servidor y se responde un cuerpo genérico.
      console.error("[kuska] error no manejado en el handler:", err);
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ code: "INTERNAL_ERROR" }));
    }
  })();
});

// sólo loopback: este servidor no valida origen ni tiene un proxy de
// confianza delante, así que no debe quedar expuesto en la red local.
server.listen(PORT, "127.0.0.1", () => {
  console.log(`[kuska] dev API server listening on http://localhost:${PORT}`);
});
