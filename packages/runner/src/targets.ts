import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { World } from "../../systems/src/generator.js";
import { SERVICE_TOKENS, userToken } from "../../systems/src/seed.js";
import { callJson, connectClient, type CallOutcome } from "../../systems/src/mcp-http.js";

export type Json = Record<string, unknown>;
export type TargetName = "service" | "user" | "gateway";

export interface CallResult {
  outcome: CallOutcome;
  /** How the source saw the call: as the service account or as the user. */
  auth: "service" | "user";
  /** Arguments the source system actually received (after any gateway enforcement). */
  upstreamArgs: Json | null;
  /** direct | allowed | clamped | denied | held | would-deny | would-hold | would-clamp */
  decision: string;
  reasons: string[];
  approvalId: number | null;
}

export interface Target {
  name: TargetName;
  /** Tool definitions as the persona's agent receives them from tools/list. */
  listTools(personId: number, bundle: string): Promise<{ name: string; description?: string; inputSchema: unknown }[]>;
  call(personId: number, bundle: string, tool: string, args: Json): Promise<CallResult>;
  close(): Promise<void>;
}

const systemOf = (tool: string) => (tool.startsWith("crm_") ? "crm" : "tickets");

/** (a) and (b): the agent connects straight to each system with one token per system. */
export function directTarget(name: "service" | "user", world: World, urls: { crm: string; tickets: string }): Target {
  const clients = new Map<string, Client>();
  const client = async (personId: number, system: "crm" | "tickets") => {
    const key = `${personId}:${system}`;
    let c = clients.get(key);
    if (!c) {
      const p = world.people.find((x) => x.id === personId)!;
      const token = name === "service" ? SERVICE_TOKENS[system] : userToken(system, system === "crm" ? p.crmUserId : p.ticketsUserId);
      c = await connectClient(urls[system], { authorization: `Bearer ${token}` });
      clients.set(key, c);
    }
    return c;
  };
  return {
    name,
    async listTools(personId) {
      const out = [];
      for (const system of ["crm", "tickets"] as const) out.push(...(await (await client(personId, system)).listTools()).tools);
      return out;
    },
    async call(personId, _bundle, tool, args) {
      const outcome = await callJson(await client(personId, systemOf(tool)), tool, args);
      return { outcome, auth: name, upstreamArgs: args, decision: "direct", reasons: [], approvalId: null };
    },
    async close() {
      await Promise.all([...clients.values()].map((c) => c.close()));
    },
  };
}
