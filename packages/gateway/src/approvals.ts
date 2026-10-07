// Approving or rejecting a held write. Approval is one atomic update, so two approvals
// at once run the write once. The write then runs as the requester (the source checks
// their permission again at that moment), carrying the approval id and the executor
// secret so the source records who signed off.
import type pg from "pg";
import { callJson, connectClient } from "../../systems/src/mcp-http.js";
import type { Policy } from "./policy.js";
import { inGroups, upstreamToken } from "./gateway.js";

export interface ExecutorOptions {
  db: pg.Pool;
  policy: Policy;
  upstreams: { crm: string; tickets: string };
  executorSecret: string;
}

export class ApprovalError extends Error {}

interface ApprovalRow {
  id: number; status: string; bundle: string; requester_person_id: number; system: "crm" | "tickets"; tool: string; args: Record<string, unknown>;
}

async function load(db: pg.Pool, id: number): Promise<ApprovalRow> {
  const r = await db.query<ApprovalRow>("select id, status, bundle, requester_person_id, system, tool, args from gateway.approvals where id = $1", [id]);
  const row = r.rows[0];
  if (!row) throw new ApprovalError(`no approval ${id}`);
  return row;
}

async function checkApprover(opts: ExecutorOptions, row: ApprovalRow, approverPersonId: number): Promise<void> {
  if (approverPersonId === row.requester_person_id) throw new ApprovalError("requesters cannot approve their own writes");
  const bundle = opts.policy.bundles[row.bundle];
  if (!bundle || !(await inGroups(opts.db, approverPersonId, bundle.approvers))) {
    throw new ApprovalError(`person ${approverPersonId} is not an approver for ${row.bundle}`);
  }
}

export async function approve(opts: ExecutorOptions, id: number, approverPersonId: number): Promise<{ status: string; result?: unknown }> {
  const row = await load(opts.db, id);
  await checkApprover(opts, row, approverPersonId);
  const claimed = await opts.db.query(
    "update gateway.approvals set status = 'approved', approver_person_id = $2 where id = $1 and status = 'pending' returning id", [id, approverPersonId]);
  if (claimed.rowCount !== 1) return { status: (await load(opts.db, id)).status };

  const client = await connectClient(opts.upstreams[row.system], {
    authorization: `Bearer ${await upstreamToken(opts.db, row.requester_person_id, row.system)}`,
    "x-approval-id": String(id),
    "x-executor-secret": opts.executorSecret,
  });
  try {
    const out = await callJson(client, row.tool, row.args);
    const status = out.ok ? "executed" : "failed";
    await opts.db.query("update gateway.approvals set status = $2, result = $3 where id = $1",
      [id, status, JSON.stringify(out.ok ? out.data : { error: out.error })]);
    return { status, result: out.ok ? out.data : out.error };
  } finally {
    await client.close();
  }
}

export async function reject(opts: Pick<ExecutorOptions, "db" | "policy" | "upstreams" | "executorSecret">, id: number, approverPersonId: number): Promise<{ status: string }> {
  const row = await load(opts.db, id);
  await checkApprover(opts, row, approverPersonId);
  const r = await opts.db.query(
    "update gateway.approvals set status = 'rejected', approver_person_id = $2 where id = $1 and status = 'pending' returning id", [id, approverPersonId]);
  return { status: r.rowCount === 1 ? "rejected" : (await load(opts.db, id)).status };
}
