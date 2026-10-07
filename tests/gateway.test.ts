import { describe, expect, it } from "vitest";
import { parsePolicy } from "../packages/gateway/src/policy.js";
import { Oracle, exposureOfRows } from "../packages/oracle/src/index.js";
import { loadSnapshot } from "../packages/runner/src/snapshot.js";
import { gatewayTarget } from "../packages/runner/src/gateway-target.js";
import { P, lastAudit, policy, withGateway, world } from "./gateway-helpers.js";
import { readFileSync } from "node:fs";

const rows = (o: { ok: boolean; data?: Record<string, unknown> }) => (o.ok ? (o.data!.rows as Record<string, unknown>[]) : []);

describe("gateway scoping", () => {
  it("rejects and logs a tool outside the bundle", () => withGateway("gh_test_gw_scope", "enforce", async (g, stack) => {
    const res = await g.call(P.rep, "emea-sales", "crm_delete_activity", { id: 1 });
    expect(res.outcome.ok).toBe(false);
    expect(res.decision).toBe("denied");
    const a = await lastAudit(stack);
    expect(a.reasons).toContain("not-in-bundle");
    expect((await stack.db.query("select count(*)::int as n from public.write_log")).rows[0].n).toBe(0);
  }));

  it("lists exactly the bundle's tools in enforce mode and the full catalog in observe mode", async () => {
    await withGateway("gh_test_gw_list", "enforce", async (g) => {
      for (const [persona, bundle] of [[P.rep, "emea-sales"], [P.support, "support"]] as const) {
        const names = (await g.listTools(persona, bundle)).map((t) => t.name).sort();
        expect(names).toEqual([...policy.bundles[bundle]!.tools].sort());
      }
    });
    await withGateway("gh_test_gw_list_obs", "observe", async (g) => {
      expect((await g.listTools(P.rep, "emea-sales")).length).toBe(40);
    });
  });

  it("overrides region, limit and fields, and the audit row keeps both versions", () => withGateway("gh_test_gw_params", "enforce", async (g, stack) => {
    const res = await g.call(P.manager, "emea-sales", "crm_list_opportunities", { region: "NA", limit: 200, fields: ["name", "discount_floor"] });
    expect(res.outcome.ok).toBe(true);
    for (const r of rows(res.outcome)) {
      expect(Object.keys(r).sort()).toEqual(["id", "name"]);
    }
    const a = await lastAudit(stack);
    expect(a.params_before).toEqual({ region: "NA", limit: 200, fields: ["name", "discount_floor"] });
    expect(a.params_after).toEqual({ region: "EMEA", limit: 50, fields: ["name"] });
    expect(a.reasons).toEqual(["pinned:region", "clamped:limit", "restricted:fields"]);
    const summary = await g.call(P.manager, "emea-sales", "crm_pipeline_summary", {});
    expect(summary.outcome.ok).toBe(true);
    for (const r of rows(summary.outcome)) expect("min_discount_floor" in r).toBe(false);
  }));

  it("lets the oracle catch a swapped identity", () => withGateway("gh_test_gw_swap", "enforce", async (g, stack) => {
    const oracle = new Oracle(world);
    const support = oracle.person(P.support);
    const engMember = world.people.find((p) => world.tickets.members.some((m) => m.project_id === 3 && m.user_id === p.ticketsUserId))!;
    const exposure = async () => {
      const res = await g.call(P.support, "support", "tickets_list_tickets", { project_id: 3 });
      return exposureOfRows(oracle, support, policy.bundles.support!, "tickets.tickets", rows(res.outcome), await loadSnapshot(stack.db), true);
    };
    expect((await exposure()).rows).toBe(0);
    // Point the support persona's ticket identity at someone in the ENG project.
    await stack.db.query("update gateway.identities set token = (select token from gateway.identities where person_id = $2 and system = 'tickets') where person_id = $1 and system = 'tickets'", [P.support, engMember.id]);
    // A fresh gateway, so no upstream client from before the swap is reused.
    const fresh = await gatewayTarget({ world, policy, stack, mode: "enforce" });
    try {
      const res = await fresh.call(P.support, "support", "tickets_list_tickets", { project_id: 3 });
      const e = exposureOfRows(oracle, support, policy.bundles.support!, "tickets.tickets", rows(res.outcome), await loadSnapshot(stack.db), true);
      expect(e.rows).toBeGreaterThan(0);
      expect(e.beyondUser).toBe(e.rows);
    } finally {
      await fresh.close();
    }
  }));
});

describe("observe mode", () => {
  it("passes calls through and records what it would have done", () => withGateway("gh_test_gw_observe", "observe", async (g, stack) => {
    const opp = world.crm.opportunities.find((o) => o.region === "EMEA" && o.owner_id === world.people.find((p) => p.id === P.rep)!.crmUserId)!;
    const res = await g.call(P.rep, "emea-sales", "crm_close_opportunity", { id: opp.id });
    expect(res.outcome.ok).toBe(true);
    expect(res.decision).toBe("would-hold");
    expect((await stack.db.query("select count(*)::int as n from public.write_log")).rows[0].n).toBe(1);

    const naOpp = world.crm.opportunities.find((o) => o.region === "NA")!;
    const denied = await g.call(P.rep, "emea-sales", "crm_close_opportunity", { id: naOpp.id });
    expect(denied.decision).toBe("would-deny");
  }));

  it("denies the same out-of-permission write in enforce mode", () => withGateway("gh_test_gw_enforce_deny", "enforce", async (g, stack) => {
    const naOpp = world.crm.opportunities.find((o) => o.region === "NA")!;
    const res = await g.call(P.rep, "emea-sales", "crm_close_opportunity", { id: naOpp.id });
    expect(res.decision).toBe("denied");
    expect((await stack.db.query("select count(*)::int as n from gateway.approvals")).rows[0].n).toBe(0);
  }));
});

describe("policy validation", () => {
  const text = readFileSync(new URL("../policy.yaml", import.meta.url), "utf8");
  it("rejects a bundle with an unknown tool", () => {
    expect(() => parsePolicy(text.replace("- crm_get_account\n", "- crm_get_acount\n"))).toThrow(/unknown tool crm_get_acount/);
  });
  it("rejects an approval rule for a tool that isn't in the bundle", () => {
    expect(() => parsePolicy(text.replace("      - tickets_update_status\n    scope:", "    scope:"))).toThrow(/not in the bundle's tools/);
  });
});
