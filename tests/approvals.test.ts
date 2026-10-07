import { describe, expect, it } from "vitest";
import { approve, reject, ApprovalError } from "../packages/gateway/src/approvals.js";
import { userToken } from "../packages/systems/src/seed.js";
import { callJson, connectClient } from "../packages/systems/src/mcp-http.js";
import { P, policy, withGateway, world } from "./gateway-helpers.js";
import type { Stack } from "../packages/runner/src/stack.js";

const rep = world.people.find((p) => p.id === P.rep)!;
const repOpps = world.crm.opportunities.filter((o) => o.owner_id === rep.crmUserId && o.stage !== "closed_won");
const opts = (stack: Stack) => ({ db: stack.db, policy, upstreams: stack.urls, executorSecret: stack.executorSecret });
const count = async (stack: Stack, sql: string) => (await stack.db.query(sql)).rows[0].n as number;
const stageOf = async (stack: Stack, id: number) => (await stack.db.query("select stage from crm.opportunities where id = $1", [id])).rows[0].stage as string;

describe("approvals", () => {
  it("a held write changes nothing until approved, then runs once with its approval id", () => withGateway("gh_test_ap_hold", "enforce", async (g, stack) => {
    const opp = repOpps[0]!;
    const held = await g.call(P.rep, "emea-sales", "crm_close_opportunity", { id: opp.id });
    expect(held.decision).toBe("held");
    expect(await count(stack, "select count(*)::int as n from public.write_log")).toBe(0);
    expect(await stageOf(stack, opp.id)).toBe(opp.stage);
    const res = await approve(opts(stack), held.approvalId!, P.approver);
    expect(res.status).toBe("executed");
    expect(await stageOf(stack, opp.id)).toBe("closed_won");
    const log = await stack.db.query("select approval_id from public.write_log");
    expect(log.rows).toEqual([{ approval_id: held.approvalId }]);
  }));

  it("a rejected write never runs, and resubmitting creates a new approval", () => withGateway("gh_test_ap_reject", "enforce", async (g, stack) => {
    const args = { id: repOpps[0]!.id };
    const first = await g.call(P.rep, "emea-sales", "crm_close_opportunity", args);
    const retry = await g.call(P.rep, "emea-sales", "crm_close_opportunity", args);
    expect(retry.approvalId).toBe(first.approvalId);
    expect((await reject(opts(stack), first.approvalId!, P.approver)).status).toBe("rejected");
    expect((await approve(opts(stack), first.approvalId!, P.approver)).status).toBe("rejected");
    expect(await count(stack, "select count(*)::int as n from public.write_log")).toBe(0);
    const again = await g.call(P.rep, "emea-sales", "crm_close_opportunity", args);
    expect(again.decision).toBe("held");
    expect(again.approvalId).not.toBe(first.approvalId);
  }));

  it("two approvals at once run the write once", () => withGateway("gh_test_ap_double", "enforce", async (g, stack) => {
    const held = await g.call(P.rep, "emea-sales", "crm_close_opportunity", { id: repOpps[0]!.id });
    const results = await Promise.all([approve(opts(stack), held.approvalId!, P.approver), approve(opts(stack), held.approvalId!, P.approver)]);
    expect(results.filter((r) => r.ran).length).toBe(1);
    expect(await count(stack, "select count(*)::int as n from public.write_log")).toBe(1);
  }));

  it("two held writes on one record run in the order they are approved", () => withGateway("gh_test_ap_order", "enforce", async (g, stack) => {
    const opp = repOpps[0]!;
    const a = await g.call(P.rep, "emea-sales", "crm_update_opportunity", { id: opp.id, data: { stage: "negotiation" } });
    const b = await g.call(P.rep, "emea-sales", "crm_close_opportunity", { id: opp.id });
    expect((await approve(opts(stack), a.approvalId!, P.approver)).status).toBe("executed");
    expect((await approve(opts(stack), b.approvalId!, P.approver)).status).toBe("executed");
    const log = await stack.db.query("select approval_id from public.write_log order by id");
    expect(log.rows.map((r) => r.approval_id)).toEqual([a.approvalId, b.approvalId]);
    expect(await stageOf(stack, opp.id)).toBe("closed_won");
  }));

  it("refuses self-approval and approval by someone outside the approver group", () => withGateway("gh_test_ap_who", "enforce", async (g, stack) => {
    const approver = world.people.find((p) => p.id === P.approver)!;
    const own = world.crm.opportunities.find((o) => o.region === "EMEA" && o.owner_id !== approver.crmUserId)!;
    const mine = await g.call(P.approver, "emea-sales", "crm_close_opportunity", { id: own.id });
    expect(mine.decision).toBe("held");
    await expect(approve(opts(stack), mine.approvalId!, P.approver)).rejects.toThrow(ApprovalError);
    const repHeld = await g.call(P.rep, "emea-sales", "crm_close_opportunity", { id: repOpps[0]!.id });
    await expect(approve(opts(stack), repHeld.approvalId!, P.manager)).rejects.toThrow(/not an approver/);
    expect(await count(stack, "select count(*)::int as n from public.write_log")).toBe(0);
  }));

  it("ignores an approval id sent without the executor secret", () => withGateway("gh_test_ap_forge", "enforce", async (_g, stack) => {
    const client = await connectClient(stack.urls.crm, {
      authorization: `Bearer ${userToken("crm", rep.crmUserId)}`, "x-approval-id": "1", "x-executor-secret": "guess",
    });
    const out = await callJson(client, "crm_close_opportunity", { id: repOpps[0]!.id });
    await client.close();
    expect(out.ok).toBe(true);
    const log = await stack.db.query("select approval_id from public.write_log");
    expect(log.rows).toEqual([{ approval_id: null }]);
  }));
});
