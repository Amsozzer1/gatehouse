import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { World } from "../../systems/src/generator.js";
import { personaToken } from "../../systems/src/seed.js";
import { callJson, connectClient } from "../../systems/src/mcp-http.js";
import type { Policy } from "../../gateway/src/policy.js";
import { startGateway, type Mode } from "../../gateway/src/gateway.js";
import { approve } from "../../gateway/src/approvals.js";
import type { Stack } from "./stack.js";
import type { Json, Target } from "./targets.js";

export interface GatewayTarget extends Target {
  /** Approves a held write as the given person and runs it. */
  approve(approvalId: number, approverPersonId: number): Promise<{ status: string }>;
}

/** (c): the agent connects to its team's bundle on the gateway with the persona's token. */
export async function gatewayTarget(opts: { world: World; policy: Policy; stack: Stack; mode: Mode }): Promise<GatewayTarget> {
  const { policy, stack, mode } = opts;
  const gateway = await startGateway({ db: stack.db, policy, upstreams: stack.urls, mode });
  const clients = new Map<string, Client>();
  const client = async (personId: number, bundle: string) => {
    const key = `${personId}:${bundle}`;
    let c = clients.get(key);
    if (!c) {
      c = await connectClient(gateway.bundleUrl(bundle), { authorization: `Bearer ${personaToken(personId)}` });
      clients.set(key, c);
    }
    return c;
  };
  return {
    name: "gateway",
    async listTools(personId, bundle) {
      return (await (await client(personId, bundle)).listTools()).tools;
    },
    async call(personId, bundle, tool, args) {
      const outcome = await callJson(await client(personId, bundle), tool, args);
      const audit = await stack.db.query<{ decision: string; reasons: string[]; params_after: Json; approval_id: number | null }>(
        "select decision, reasons, params_after, approval_id from gateway.audit_log order by id desc limit 1");
      const row = audit.rows[0]!;
      const forwarded = row.decision !== "denied" && row.decision !== "held";
      return {
        outcome,
        auth: "user",
        upstreamArgs: forwarded ? row.params_after : null,
        decision: row.decision,
        reasons: row.reasons,
        approvalId: row.approval_id,
      };
    },
    approve: (approvalId, approverPersonId) =>
      approve({ db: stack.db, policy, upstreams: stack.urls, executorSecret: stack.executorSecret }, approvalId, approverPersonId),
    async close() {
      await Promise.all([...clients.values()].map((c) => c.close()));
      await gateway.close();
    },
  };
}
