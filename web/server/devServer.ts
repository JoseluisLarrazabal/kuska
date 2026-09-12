import http from "node:http";
import relayHandler from "../api/relay";
import faucetHandler from "../api/faucet";
import healthHandler from "../api/health";

const PORT = 8787;

type Handler = (request: Request) => Promise<Response>;

const routes: Record<string, Handler> = {
  "/api/relay": relayHandler,
  "/api/faucet": faucetHandler,
  "/api/health": healthHandler,
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
    const handler = routes[url.pathname];
    if (!handler) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    try {
      const request = await toWebRequest(req);
      const response = await handler(request);
      await writeWebResponse(res, response);
    } catch (err) {
      res.statusCode = 500;
      res.end(err instanceof Error ? err.message : "Internal error");
    }
  })();
});

server.listen(PORT, () => {
  console.log(`[kuska] dev API server listening on http://localhost:${PORT}`);
});
