// The gateway. One MCP endpoint per team bundle (/mcp/<bundle>). For each call it:
//   1. rejects tools outside the bundle,
//   2. pins params (region, limit, fields) so the source returns only the team's scope,
//   3. for writes that need approval: dry-runs as the user, then holds the call,
//   4. otherwise calls the source as the actual user,
//   5. writes one audit row.
// In observe mode it logs what it would have done and passes the original call through.
import { createHash } from "node:crypto";
import type pg from "pg";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { bearer, callJson, connectClient, errorResult, jsonResult, serveMcp, type RunningServer } from "../../systems/src/mcp-http.js";
import { toolByName } from "../../systems/src/tools.js";
import type { BundlePolicy, Policy } from "./policy.js";

export type Mode = "enforce" | "observe";
type Json = Record<string, unknown>;

export interface GatewayOptions {
  db: pg.Pool;
  policy: Policy;
  upstreams: { crm: string; tickets: string };
  mode: Mode;
  port?: number;
}

export interface Gateway extends RunningServer {
  bundleUrl(bundle: string): string;
}

const systemOf = (tool: string): "crm" | "tickets" => (tool.startsWith("crm_") ? "crm" : "tickets");

/** Pins the bundle's scope params. Returns the new args and what changed. */
export function pinParams(bundle: BundlePolicy, tool: string, args: Json): { args: Json; reasons: string[] } {
  const def = toolByName(tool);
  const props = ((def?.inputSchema.properties ?? {}) as Json);
  const out: Json = { ...args };
  const reasons: string[] = [];
  const enforce = bundle.enforce;
  if (enforce.region && "region" in props && out.region !== enforce.region) {
    out.region = enforce.region;
    reasons.push("pinned:region");
  }
  if (enforce.max_limit && "limit" in props && typeof out.limit === "number" && out.limit > enforce.max_limit) {
    out.limit = enforce.max_limit;
    reasons.push("clamped:limit");
  }
  const allowed = def ? enforce.fields?.[`${def.system}.${def.entity}`] : undefined;
  if (allowed && "fields" in props) {
    const asked = Array.isArray(out.fields) ? (out.fields as string[]) : null;
    const next = asked ? asked.filter((f) => allowed.includes(f)) : [...allowed];
    if (!asked || next.length !== asked.length) reasons.push("restricted:fields");
    out.fields = next;
  }
  return { args: out, reasons };
}

export function idemKey(personId: number, tool: string, args: Json): string {
  const canonical = JSON.stringify(Object.keys(args).sort().map((k) => [k, args[k]]));
  return createHash("sha256").update(`${personId}|${tool}|${canonical}`).digest("hex");
}

export async function personForToken(db: pg.Pool, token: string | undefined): Promise<number | null> {
  if (!token) return null;
  const r = await db.query<{ person_id: number }>("select person_id from gateway.persona_tokens where token = $1", [token]);
  return r.rows[0]?.person_id ?? null;
}

export async function inGroups(db: pg.Pool, personId: number, groups: string[]): Promise<boolean> {
  const r = await db.query("select 1 from gateway.groups where person_id = $1 and name = any($2)", [personId, groups]);
  return (r.rowCount ?? 0) > 0;
}

export async function upstreamToken(db: pg.Pool, personId: number, system: "crm" | "tickets"): Promise<string> {
  const r = await db.query<{ token: string }>("select token from gateway.identities where person_id = $1 and system = $2", [personId, system]);
  const token = r.rows[0]?.token;
  if (!token) throw new Error(`no ${system} identity for person ${personId}`);
  return token;
}

export async function startGateway(opts: GatewayOptions): Promise<Gateway> {
  const { db, policy, upstreams, mode } = opts;
  const clients = new Map<string, Client>();
  const upstream = async (personId: number, system: "crm" | "tickets") => {
    const key = `${personId}:${system}`;
    let c = clients.get(key);
    if (!c) {
      c = await connectClient(upstreams[system], { authorization: `Bearer ${await upstreamToken(db, personId, system)}` });
      clients.set(key, c);
    }
    return c;
  };
  let catalog: { name: string; description?: string; inputSchema: unknown }[] | null = null;

  const audit = async (row: {
    personId: number | null; bundle: string; tool: string; before: Json; after: Json; decision: string;
    reasons: string[]; itemCount: number | null; approvalId: number | null; started: number;
  }) => {
    await db.query(
      `insert into gateway.audit_log (person_id, bundle, tool, mode, params_before, params_after, decision, reasons, item_count, approval_id, latency_ms)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [row.personId, row.bundle, row.tool, mode, JSON.stringify(row.before), JSON.stringify(row.after), row.decision,
        JSON.stringify(row.reasons), row.itemCount, row.approvalId, performance.now() - row.started]);
  };

  const running = await serveMcp(async (req, path) => {
    const match = /^\/mcp\/([a-z0-9-]+)$/.exec(path);
    const bundle = match ? policy.bundles[match[1]!] : undefined;
    if (!bundle) return null;
    const token = bearer(req);

    const server = new Server({ name: `gateway-${bundle.name}`, version: "0.1.0" }, { capabilities: { tools: {} } });

    server.setRequestHandler(ListToolsRequestSchema, async () => {
      const personId = await personForToken(db, token);
      if (personId === null || !(await inGroups(db, personId, bundle.members))) return { tools: [] };
      if (!catalog) {
        catalog = [];
        for (const system of ["crm", "tickets"] as const) catalog.push(...(await (await upstream(personId, system)).listTools()).tools);
      }
      const tools = mode === "enforce" ? catalog.filter((t) => bundle.tools.includes(t.name)) : catalog;
      return { tools: tools.map((t) => ({ ...t, inputSchema: t.inputSchema as { type: "object" } })) };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const started = performance.now();
      const tool = request.params.name;
      const before = (request.params.arguments ?? {}) as Json;
      const personId = await personForToken(db, token);
      const base = { personId, bundle: bundle.name, tool, before, started };
      if (personId === null || !(await inGroups(db, personId, bundle.members))) {
        await audit({ ...base, after: before, decision: "denied", reasons: ["not-a-member"], itemCount: null, approvalId: null });
        return errorResult(`blocked by gateway: not a member of ${bundle.name}`);
      }
      const def = toolByName(tool);
      const reasons: string[] = [];
      let decision = "allowed";

      // 1. Tool must be in the bundle.
      if (!def || !bundle.tools.includes(tool)) {
        reasons.push("not-in-bundle");
        if (mode === "enforce" || !def) {
          await audit({ ...base, after: before, decision: "denied", reasons, itemCount: null, approvalId: null });
          return errorResult(`blocked by gateway: ${tool} is not in the ${bundle.name} bundle`);
        }
        decision = "would-deny";
      }

      // 2. Pinned params.
      const enforced = pinParams(bundle, tool, before);
      reasons.push(...enforced.reasons);
      if (enforced.reasons.length > 0 && decision === "allowed") decision = mode === "enforce" ? "clamped" : "would-clamp";
      const sent = mode === "enforce" ? enforced.args : before;
      const client = await upstream(personId, systemOf(tool));

      // 3. Writes that need approval: dry-run as the user, then hold.
      if (bundle.approvals.includes(tool)) {
        const dry = await callJson(client, tool, { ...sent, dry_run: true });
        if (!dry.ok) {
          reasons.push(`source-denied: ${dry.error}`);
          if (mode === "enforce") {
            await audit({ ...base, after: sent, decision: "denied", reasons, itemCount: null, approvalId: null });
            return errorResult(dry.error);
          }
          if (decision === "allowed" || decision === "would-clamp") decision = "would-deny";
        } else if (mode === "enforce") {
          const key = idemKey(personId, tool, sent);
          const inserted = await db.query<{ id: number }>(
            `insert into gateway.approvals (idem_key, status, bundle, requester_person_id, system, tool, args)
             values ($1, 'pending', $2, $3, $4, $5, $6) on conflict (idem_key) where status = 'pending' do nothing returning id`,
            [key, bundle.name, personId, systemOf(tool), tool, JSON.stringify(sent)]);
          const id = inserted.rows[0]?.id
            ?? (await db.query<{ id: number }>("select id from gateway.approvals where idem_key = $1 and status = 'pending'", [key])).rows[0]!.id;
          reasons.push("approval-required");
          await audit({ ...base, after: sent, decision: "held", reasons, itemCount: null, approvalId: id });
          return jsonResult({ held: true, approval_id: id, message: `Held for approval by ${bundle.approvers.join(", ")}.` });
        } else {
          reasons.push("approval-required");
          if (decision === "allowed" || decision === "would-clamp") decision = "would-hold";
        }
      }

      // 4. Call the source as the user.
      const out = await callJson(client, tool, sent);
      const itemCount = out.ok ? ((out.data.rows as unknown[] | undefined)?.length ?? (out.data.row ? 1 : null)) : null;
      if (!out.ok) reasons.push(`source-error: ${out.error}`);
      await audit({ ...base, after: sent, decision, reasons, itemCount, approvalId: null });
      return out.ok ? jsonResult(out.data) : errorResult(out.error);
    });
    return server;
  }, opts.port ?? 0);

  return {
    url: running.url,
    bundleUrl: (bundle) => `${running.url}/mcp/${bundle}`,
    async close() {
      await Promise.all([...clients.values()].map((c) => c.close()));
      await running.close();
    },
  };
}
