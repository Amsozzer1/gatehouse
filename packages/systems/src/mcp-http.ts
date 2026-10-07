// Stateless MCP over Streamable HTTP: a fresh Server and transport for every HTTP request,
// so identity can be read from the request when the server is built.
import http, { type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface RunningServer {
  url: string;
  close(): Promise<void>;
}

/** `route` returns a server for this request, or null for 404. */
export async function serveMcp(route: (req: IncomingMessage, path: string) => Promise<Server | null>, port = 0): Promise<RunningServer> {
  const httpServer = http.createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path === "/health") {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json" })
        .end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }));
      return;
    }
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const server = await route(req, path);
      if (!server) {
        res.writeHead(404).end();
        return;
      }
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" })
          .end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: String(err) }, id: null }));
      }
    }
  });
  await new Promise<void>((resolve) => httpServer.listen(port, "127.0.0.1", resolve));
  const { port: actual } = httpServer.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${actual}`,
    close: () => new Promise<void>((resolve, reject) => {
      httpServer.closeAllConnections();
      httpServer.close((err) => (err ? reject(err) : resolve()));
    }),
  };
}

export function bearer(req: IncomingMessage): string | undefined {
  const h = req.headers.authorization;
  return h?.startsWith("Bearer ") ? h.slice("Bearer ".length) : undefined;
}

export async function connectClient(url: string, headers: Record<string, string>): Promise<Client> {
  const client = new Client({ name: "gatehouse-client", version: "0.1.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }));
  return client;
}

export type CallOutcome = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };

/** Calls a tool and decodes the JSON text result the systems and gateway return. */
export async function callJson(client: Client, name: string, args: Record<string, unknown>): Promise<CallOutcome> {
  const res = await client.callTool({ name, arguments: args });
  const content = res.content as { type: string; text?: string }[];
  const text = content.find((c) => c.type === "text")?.text ?? "";
  if (res.isError) return { ok: false, error: text };
  return { ok: true, data: JSON.parse(text) as Record<string, unknown> };
}

export function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

export function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}
