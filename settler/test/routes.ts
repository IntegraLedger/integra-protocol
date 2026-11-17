// A node stub that answers by route, with the HTTP status a node gives (a Mirror Node's 404 for an id it does not hold,
// its 400 for a contract call the EVM reverted): each request's path and JSON body go to `answer`, which returns the
// JSON to send, or `{ status, json }`.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export class Status {
  constructor(
    readonly status: number,
    readonly json: unknown,
  ) {}
}

export interface Routes {
  readonly url: string;
  readonly calls: { readonly method: string; readonly path: string; readonly body: unknown }[];
  close(): Promise<void>;
}

export async function routes(answer: (path: string, body: unknown, method: string) => unknown): Promise<Routes> {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const parts: Buffer[] = [];
    for await (const c of req) parts.push(c as Buffer);
    const text = Buffer.concat(parts).toString("utf8");
    const body: unknown = text === "" ? undefined : JSON.parse(text);
    const call = { method: req.method ?? "GET", path: req.url ?? "", body };
    calls.push(call);
    let value: unknown;
    try {
      value = await answer(call.path, body, call.method);
    } catch {
      value = new Status(500, { error: "stub" });
    }
    const status = value instanceof Status ? value.status : 200;
    res.writeHead(status, { "content-type": "application/json", connection: "close" });
    res.end(JSON.stringify(value instanceof Status ? value.json : value));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** The settler started through its core with one test list, over a fresh database, and its HTTP calls. */
export interface Serving {
  verify(body: unknown): Promise<unknown>;
  settle(body: unknown): Promise<unknown>;
  supported(): Promise<unknown>;
  close(): Promise<void>;
}

export const CREDENTIAL = "cHVibGlzaGVkLWItdGVzdA";

export async function serving(
  start: (port: number, store: string) => Promise<{ close(): Promise<void> }>,
): Promise<Serving> {
  const { freshDatabase, onLockedPort } = await import("./support.js");
  const db = await freshDatabase();
  const { port, server } = await onLockedPort((p) => start(p, db.url));
  const base = `http://127.0.0.1:${port}`;
  const headers = { "content-type": "application/json", authorization: `Bearer ${CREDENTIAL}` };
  const post = async (path: string, body: unknown) =>
    (await fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) })).json();
  return {
    verify: (body) => post("/verify", body),
    settle: (body) => post("/settle", body),
    supported: async () => (await fetch(`${base}/supported`, { headers })).json(),
    async close() {
      await server.close();
      await db.drop();
    },
  };
}
