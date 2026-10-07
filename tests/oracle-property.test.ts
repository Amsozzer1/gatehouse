// The SQL enforcement in each mock system and the oracle's canSee are written separately.
// This checks they agree for every generated user and every read query, on seed 42.
// It calls the query layer directly; the MCP smoke test in systems.test.ts covers the wire.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { generateWorld } from "../packages/systems/src/generator.js";
import { createPool } from "../packages/systems/src/db.js";
import { createRunDb, dropRunDb } from "../packages/systems/src/seed.js";
import { TOOLS, ToolError, type ToolContext } from "../packages/systems/src/tools.js";
import { ENTITIES } from "../packages/systems/src/entities.js";
import type { Principal } from "../packages/systems/src/access.js";
import { Oracle, type EntityKey, type Row, type Snapshot } from "../packages/oracle/src/index.js";
import { loadSnapshot } from "../packages/runner/src/snapshot.js";

const world = generateWorld(42);
const oracle = new Oracle(world);
let pool: pg.Pool;
let snap: Snapshot;

beforeAll(async () => {
  pool = createPool(await createRunDb("gh_test_property"));
  snap = await loadSnapshot(pool);
});
afterAll(async () => {
  await pool.end();
  await dropRunDb("gh_test_property");
});

async function run(name: string, who: Principal, args: Record<string, unknown>) {
  const ctx: ToolContext = { db: pool, who, approvalId: null };
  try {
    return { ok: true as const, data: await TOOLS.find((t) => t.name === name)!.run(ctx, args) };
  } catch (err) {
    if (err instanceof ToolError) return { ok: false as const, error: err.message };
    throw err;
  }
}

describe("SQL enforcement equals canSee", () => {
  for (const person of world.people) {
    it(`agrees for ${person.crmRole} ${person.id}`, async () => {
      for (const e of ENTITIES) {
        const key = `${e.system}.${e.plural}` as EntityKey;
        const who: Principal = { kind: "user", system: e.system, userId: e.system === "crm" ? person.crmUserId : person.ticketsUserId, role: e.system === "crm" ? person.crmRole : null };
        const all = [...snap[key].values()];
        const expected = all.filter((r) => oracle.canSee(person, key, r, snap)).map((r) => r.id as number);
        const expectedCols = e.columns.filter((c) => oracle.canSeeField(person, key, c));

        // list, paged to the end
        const listed: Row[] = [];
        let listDenied = false;
        for (let offset = 0; ; offset += 200) {
          const out = await run(`${e.system}_list_${e.plural}`, who, { limit: 200, offset });
          if (!out.ok) { listDenied = true; break; }
          const rows = out.data.rows as Row[];
          listed.push(...rows);
          if (rows.length < 200) break;
        }
        if (listDenied) expect(expected, `${key} list denied but oracle allows rows`).toEqual([]);
        else {
          expect(listed.map((r) => r.id), `${key} list`).toEqual(expected);
          for (const r of listed) expect(Object.keys(r).sort(), `${key} columns`).toEqual([...expectedCols].sort());
        }

        // get on every id
        for (const r of all) {
          const out = await run(`${e.system}_get_${e.singular}`, who, { id: r.id });
          expect(out.ok, `${key} get ${r.id}`).toBe(expected.includes(r.id as number));
        }

        // search
        const q = "a";
        const searched = await run(`${e.system}_search_${e.plural}`, who, { query: q, limit: 200 });
        const expectedSearch = all
          .filter((r) => oracle.canSee(person, key, r, snap) && e.searchable.some((c) => String(r[c]).toLowerCase().includes(q)))
          .map((r) => r.id as number);
        if (!searched.ok) expect(expectedSearch).toEqual([]);
        else expect((searched.data.rows as Row[]).map((r) => r.id), `${key} search`).toEqual(expectedSearch);
      }

      // aggregate
      const who: Principal = { kind: "user", system: "crm", userId: person.crmUserId, role: person.crmRole };
      const summary = await run("crm_pipeline_summary", who, { close_quarter: "2026-Q3" });
      const inputs = [...snap["crm.opportunities"].values()].filter((r) => r.close_quarter === "2026-Q3" && oracle.canSee(person, "crm.opportunities", r, snap));
      if (!summary.ok) expect(inputs).toEqual([]);
      else {
        const rows = summary.data.rows as Row[];
        expect(rows.reduce((s, r) => s + (r.count as number), 0)).toBe(inputs.length);
        const floorVisible = oracle.canSeeField(person, "crm.opportunities", "discount_floor");
        for (const r of rows) expect(r.min_discount_floor === null).toBe(!floorVisible);
      }
    });
  }
});
