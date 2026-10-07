import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { generateWorld, personById } from "../packages/systems/src/generator.js";
import { seedFresh, dropRunDb, userToken } from "../packages/systems/src/seed.js";
import { TOOLS, toolsFor } from "../packages/systems/src/tools.js";
import { callJson } from "../packages/systems/src/mcp-http.js";
import { startSystemsStack, type SystemsStack } from "./helpers.js";

const world = generateWorld(42);

async function tableHashes(url: string): Promise<Record<string, string>> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  const tables = await c.query<{ t: string }>(
    "select table_schema || '.' || table_name as t from information_schema.tables where table_schema in ('crm','tickets','gateway','public') order by 1");
  const out: Record<string, string> = {};
  for (const { t } of tables.rows) {
    const r = await c.query<{ h: string }>(`select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h from ${t} x`);
    out[t] = r.rows[0]!.h;
  }
  await c.end();
  return out;
}

describe("seed", () => {
  it("gives identical row hashes when run twice", async () => {
    const a = await seedFresh("gh_test_seed_a", generateWorld(42));
    const b = await seedFresh("gh_test_seed_b", generateWorld(42));
    const [ha, hb] = [await tableHashes(a), await tableHashes(b)];
    await dropRunDb("gh_test_seed_a");
    await dropRunDb("gh_test_seed_b");
    expect(Object.keys(ha).length).toBeGreaterThan(10);
    expect(ha).toEqual(hb);
  });

  it("gives restricted values that occur nowhere else in the seeded data", () => {
    const floors = world.crm.opportunities.map((o) => o.discount_floor);
    expect(new Set(floors).size).toBe(floors.length);
    const others = JSON.stringify({
      people: world.people, accounts: world.crm.accounts, contacts: world.crm.contacts, activities: world.crm.activities,
      tickets: world.tickets, opps: world.crm.opportunities.map(({ discount_floor: _d, ...rest }) => rest),
    });
    for (const v of floors) expect(others.includes(v)).toBe(false);
  });
});

describe("mock systems over MCP", () => {
  let stack: SystemsStack;
  beforeAll(async () => { stack = await startSystemsStack("gh_test_systems"); });
  afterAll(async () => { await stack.close(); });

  it("lists every tool and can call each one", async () => {
    expect(TOOLS.length).toBeGreaterThanOrEqual(35);
    expect(TOOLS.length).toBeLessThanOrEqual(45);
    for (const system of ["crm", "tickets"] as const) {
      const client = await stack.service(system);
      const listed = (await client.listTools()).tools.map((t) => t.name).sort();
      expect(listed).toEqual(toolsFor(system).map((t) => t.name).sort());
      for (const tool of toolsFor(system)) {
        const args: Record<string, unknown> =
          tool.name.includes("_search_") ? { query: "a" }
          : tool.name.includes("_get_") ? { id: 1 }
          : tool.name.includes("_list_") || tool.kind === "aggregate" ? {}
          : tool.name.includes("_create_") ? { data: {}, dry_run: true }
          : tool.name === "tickets_add_comment" ? { ticket_id: 1, body: "x", dry_run: true }
          : tool.name === "tickets_update_status" ? { id: 1, status: "open", dry_run: true }
          : tool.name.includes("_update_") ? { id: 1, data: {}, dry_run: true }
          : { id: 1, dry_run: true };
        const out = await callJson(client, tool.name, args);
        expect(out.ok, `${tool.name}: ${out.ok ? "" : out.error}`).toBe(true);
      }
    }
  });

  it("honours region and fields on every read tool (pushdown)", async () => {
    const crm = await stack.service("crm");
    for (const tool of toolsFor("crm").filter((t) => t.kind !== "write")) {
      const fields = tool.kind === "aggregate" ? ["stage", "amount"] : ["id", "region"];
      const base: Record<string, unknown> = tool.name.includes("_search_") ? { query: "a" } : {};
      if (tool.name.includes("_get_")) {
        const naId = world.crm.opportunities.find((o) => o.region === "NA")!.id;
        if (tool.entity === "opportunities") {
          const miss = await callJson(crm, tool.name, { id: naId, region: "EMEA", fields });
          expect(miss.ok).toBe(false);
        }
        const emeaId = { accounts: world.crm.accounts, contacts: world.crm.contacts, opportunities: world.crm.opportunities, activities: world.crm.activities }[
          tool.entity as "accounts"]!.find((r) => r.region === "EMEA")!.id;
        const hit = await callJson(crm, tool.name, { id: emeaId, region: "EMEA", fields });
        expect(hit.ok).toBe(true);
        if (hit.ok) expect(Object.keys(hit.data.row as object).sort()).toEqual(["id", "region"]);
        continue;
      }
      const out = await callJson(crm, tool.name, { ...base, region: "EMEA", fields });
      expect(out.ok, tool.name).toBe(true);
      if (!out.ok) continue;
      const rows = out.data.rows as Record<string, unknown>[];
      expect(rows.length).toBeGreaterThan(0);
      if (tool.kind === "aggregate") {
        for (const r of rows) expect(Object.keys(r).sort()).toEqual(["count", "stage", "total_amount"]);
        const total = rows.reduce((s, r) => s + (r.count as number), 0);
        expect(total).toBe(world.crm.opportunities.filter((o) => o.region === "EMEA").length);
      } else {
        for (const r of rows) {
          expect(r.region).toBe("EMEA");
          expect(Object.keys(r).sort()).toEqual(["id", "region"]);
        }
      }
    }
  });

  it("applies each system's own permissions to user tokens", async () => {
    const rep = personById(world, world.personas.rep);
    const crm = await stack.client("crm", userToken("crm", rep.crmUserId));
    const opps = await callJson(crm, "crm_list_opportunities", { limit: 200 });
    expect(opps.ok).toBe(true);
    if (opps.ok) {
      const rows = opps.data.rows as Record<string, unknown>[];
      expect(rows.length).toBe(world.crm.opportunities.filter((o) => o.region === "EMEA").length);
      for (const r of rows) {
        expect(r.region).toBe("EMEA");
        expect("discount_floor" in r).toBe(false);
      }
    }
    const naOpp = world.crm.opportunities.find((o) => o.region === "NA")!;
    const denied = await callJson(crm, "crm_close_opportunity", { id: naOpp.id, dry_run: true });
    expect(denied.ok).toBe(false);

    const support = personById(world, world.personas.support);
    const crmSupport = await stack.client("crm", userToken("crm", support.crmUserId));
    expect((await callJson(crmSupport, "crm_list_opportunities", {})).ok).toBe(false);
    expect((await callJson(crmSupport, "crm_search_accounts", { query: "a" })).ok).toBe(true);
  });

  it("lets both sales personas comment on and update the escalation ticket", async () => {
    for (const id of [world.personas.rep, world.personas.manager]) {
      const p = personById(world, id);
      const t = await stack.client("tickets", userToken("tickets", p.ticketsUserId));
      const target = world.targets.escalationTicketId;
      expect((await callJson(t, "tickets_add_comment", { ticket_id: target, body: "x", dry_run: true })).ok).toBe(true);
      expect((await callJson(t, "tickets_update_status", { id: target, status: "in_progress", dry_run: true })).ok).toBe(true);
    }
  });
});
