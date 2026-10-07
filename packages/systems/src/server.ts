import type pg from "pg";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { SystemName } from "./entities.js";
import { resolveToken } from "./access.js";
import { ToolError, toolsFor } from "./tools.js";
import { bearer, errorResult, jsonResult, serveMcp, type RunningServer } from "./mcp-http.js";

export interface SystemOptions {
  system: SystemName;
  db: pg.Pool;
  /** Writes carrying this secret in x-executor-secret get their x-approval-id recorded. */
  executorSecret: string;
  port?: number;
}

export async function startSystem(opts: SystemOptions): Promise<RunningServer> {
  const tools = toolsFor(opts.system);
  const running = await serveMcp(async (req, path) => {
    if (path !== "/mcp") return null;
    const token = bearer(req);
    const secret = req.headers["x-executor-secret"];
    const approvalHeader = req.headers["x-approval-id"];
    const approvalId = secret === opts.executorSecret && typeof approvalHeader === "string" && /^\d+$/.test(approvalHeader)
      ? Number(approvalHeader) : null;

    const server = new Server({ name: `mock-${opts.system}`, version: "0.1.0" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema as { type: "object" } })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const who = await resolveToken(opts.db, opts.system, token);
      if (!who) return errorResult("unauthorized: missing or unknown token");
      const tool = tools.find((t) => t.name === request.params.name);
      if (!tool) return errorResult(`unknown tool ${request.params.name}`);
      try {
        return jsonResult(await tool.run({ db: opts.db, who, approvalId }, request.params.arguments ?? {}));
      } catch (err) {
        if (err instanceof ToolError) return errorResult(err.message);
        throw err;
      }
    });
    return server;
  }, opts.port ?? 0);
  return { url: `${running.url}/mcp`, close: running.close };
}
