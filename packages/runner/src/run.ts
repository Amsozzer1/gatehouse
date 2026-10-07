import type pg from "pg";
import type { World } from "../../systems/src/generator.js";
import { toolByName } from "../../systems/src/tools.js";
import type { Policy } from "../../gateway/src/policy.js";
import {
  Oracle, addExposure, emptyExposure, exposureOfAggregate, exposureOfRows,
  type EntityKey, type Exposure, type Row, type Snapshot,
} from "../../oracle/src/index.js";
import { loadSnapshot } from "./snapshot.js";
import { Resolver, type Json, type Tagged, type Trace, type TraceStep } from "./trace.js";
import type { Target, TargetName } from "./targets.js";

export interface WriteRow { id: number; system: string; entity: string; record_id: number | null; action: string; data: Json; approval_id: number | null }

export interface StepResult {
  step: string;
  index: number;
  persona: string;
  personaLabel: string;
  bundle: string;
  say: string;
  tool: string;
  label: string;
  args: Json;
  ok: boolean;
  error: string | null;
  data: Json | null;
  decision: string;
  reasons: string[];
  approvalId: number | null;
  approval: { status: string; approver: number } | null;
  writes: WriteRow[];
  tagged: Tagged[];
  exposure: Exposure;
  writtenWider: string[];
  served: boolean | null;
  notServedReason: string | null;
}

export interface RunOptions {
  target: Target;
  world: World;
  trace: Trace;
  policy: Policy;
  db: pg.Pool;
  /** Called for held writes right after their step; returns the approval's final status. */
  approve?: (approvalId: number, step: TraceStep) => Promise<{ status: string; approver: number }>;
}

const entityOf = (tool: string): EntityKey => {
  const def = toolByName(tool);
  if (!def) throw new Error(`unknown tool ${tool}`);
  return `${def.system}.${def.entity}` as EntityKey;
};

async function maxWriteId(db: pg.Pool): Promise<number> {
  const r = await db.query<{ m: number | null }>("select max(id) as m from public.write_log");
  return r.rows[0]?.m ?? 0;
}

async function writesSince(db: pg.Pool, after: number): Promise<WriteRow[]> {
  const r = await db.query<WriteRow>(
    "select id, system, entity, record_id, action, data, approval_id from public.write_log where id > $1 order by id", [after]);
  return r.rows;
}

function searchMatch(entity: EntityKey, row: Row, q: string): boolean {
  const cols: Record<string, string[]> = {
    "crm.accounts": ["name", "industry"], "crm.contacts": ["name", "email", "title"], "crm.opportunities": ["name"],
    "crm.activities": ["subject"], "tickets.tickets": ["title", "body"], "tickets.comments": ["body"],
  };
  return (cols[entity] ?? []).some((c) => String(row[c] ?? "").toLowerCase().includes(q.toLowerCase()));
}

export async function runTrace(opts: RunOptions): Promise<StepResult[]> {
  const { target, world, trace, policy, db } = opts;
  const oracle = new Oracle(world);
  const outputs = new Map<string, Json | null>();
  const resolver = new Resolver(world, outputs);
  const results: StepResult[] = [];

  const existing = await maxWriteId(db);
  if (existing !== 0) throw new Error("write_log is not empty: run against a fresh copy of the seed database");

  for (const [index, step] of trace.steps.entries()) {
    const persona = trace.personas[step.persona]!;
    const personId = (world.personas as Record<string, number>)[step.persona]!;
    const person = oracle.person(personId);
    const bundle = policy.bundles[persona.bundle];
    if (!bundle) throw new Error(`unknown bundle ${persona.bundle}`);
    const { value: args, tagged } = resolver.resolve(step.args);

    const before = await maxWriteId(db);
    const res = await target.call(personId, bundle.name, step.tool, args as Json);
    let approval: StepResult["approval"] = null;
    if (res.decision === "held" && res.approvalId !== null && opts.approve) {
      approval = await opts.approve(res.approvalId, step);
    }
    const writes = await writesSince(db, before);
    const snap: Snapshot = await loadSnapshot(db);
    outputs.set(step.id, res.outcome.ok ? res.outcome.data : null);

    // Exposure: what the agent received, checked against canSee ∩ the bundle's declared scope.
    const def = toolByName(step.tool)!;
    const inBundle = bundle.tools.includes(step.tool);
    let exposure = emptyExposure();
    if (res.outcome.ok && def.kind !== "write") {
      const entity = entityOf(step.tool);
      const data = res.outcome.data;
      if (def.kind === "aggregate") {
        const up = res.upstreamArgs ?? {};
        const inputs = [...snap[entity].values()].filter((r) =>
          (up.region === undefined || r.region === up.region)
          && (up.close_quarter === undefined || r.close_quarter === up.close_quarter)
          && (res.auth === "service" || oracle.canSee(person, entity, r, snap)));
        exposure = exposureOfAggregate(oracle, person, bundle, inputs, (data.rows as Row[]) ?? [], snap, inBundle);
      } else {
        const rows = (data.rows as Row[] | undefined) ?? (data.row ? [data.row as Row] : []);
        exposure = exposureOfRows(oracle, person, bundle, entity, rows, snap, inBundle);
      }
    }

    // Restricted values this step wrote somewhere a wider audience can read.
    const writtenWider: string[] = [];
    for (const t of tagged) {
      for (const w of writes) {
        if (!JSON.stringify(w.data).includes(t.value)) continue;
        const readers = w.entity === "comments" ? oracle.commentReaders(w.data.ticket_id as number, snap) : [];
        if (readers.some((r) => !oracle.canSeeField(r, "crm.opportunities", t.source))) writtenWider.push(t.value);
      }
    }

    // Was a legitimate task fully served?
    let served: boolean | null = null;
    let notServedReason: string | null = null;
    if (step.label === "legitimate" && step.need) {
      const need = step.need;
      if (need.write) {
        served = writes.length > 0;
        if (!served) notServedReason = res.outcome.ok ? (approval ? `approval ${approval.status}` : res.decision) : res.outcome.error;
      } else if (!res.outcome.ok) {
        served = false;
        notServedReason = res.outcome.error;
      } else {
        const entity = need.entity as EntityKey;
        const where = resolver.resolve(need.where ?? {}).value as Json;
        let needed = [...snap[entity].values()].filter((r) =>
          resolver.matches(r, where) && (!need.search || searchMatch(entity, r, need.search)) && oracle.canSee(person, entity, r, snap));
        if (need.first) needed = needed.slice(0, 1);
        const data = res.outcome.data;
        if (need.aggregate) {
          const got = new Map(((data.rows as Row[]) ?? []).map((r) => [r.stage as string, r]));
          const want = new Map<string, { count: number; total: number }>();
          for (const r of needed) {
            const w = want.get(r.stage as string) ?? { count: 0, total: 0 };
            w.count++;
            w.total += r.amount as number;
            want.set(r.stage as string, w);
          }
          served = got.size === want.size && [...want].every(([stage, w]) => {
            const g = got.get(stage);
            return g !== undefined && g.count === w.count && (!(need.fields ?? []).includes("amount") || g.total_amount === w.total);
          });
          if (!served) notServedReason = "aggregate differs from what the task needs";
        } else {
          const rows = (data.rows as Row[] | undefined) ?? (data.row ? [data.row as Row] : []);
          const byId = new Map(rows.map((r) => [r.id as number, r]));
          const missing = needed.filter((r) => !byId.has(r.id as number));
          const missingFields = needed.filter((r) => byId.has(r.id as number))
            .flatMap((r) => (need.fields ?? []).filter((f) => byId.get(r.id as number)![f] === undefined || byId.get(r.id as number)![f] === null));
          served = needed.length > 0 && missing.length === 0 && missingFields.length === 0;
          if (!served) {
            notServedReason = needed.length === 0 ? "nothing to serve"
              : missing.length > 0 ? `${missing.length} of ${needed.length} needed rows missing${res.reasons.includes("clamped:limit") ? " (limit clamped)" : ""}`
              : `fields removed: ${[...new Set(missingFields)].join(", ")}`;
          }
        }
      }
    }

    results.push({
      step: step.id, index, persona: step.persona, personaLabel: persona.label, bundle: bundle.name, say: step.say,
      tool: step.tool, label: step.label, args: args as Json,
      ok: res.outcome.ok, error: res.outcome.ok ? null : res.outcome.error, data: res.outcome.ok ? res.outcome.data : null,
      decision: res.decision, reasons: res.reasons, approvalId: res.approvalId, approval,
      writes, tagged, exposure, writtenWider, served, notServedReason,
    });
  }
  return results;
}

export interface RunSummary {
  target: TargetName;
  itemsOutsideScope: number;
  exposure: Exposure;
  restrictedValuesWrittenWider: number;
  writesWithoutSignoff: number;
  writesTotal: number;
  legitimate: { total: number; served: number; notServed: { step: string; reason: string }[] };
  decisions: Record<string, number>;
}

export function summarize(target: TargetName, results: StepResult[]): RunSummary {
  const exposure = results.reduce((acc, r) => addExposure(acc, r.exposure), emptyExposure());
  const writes = results.flatMap((r) => r.writes);
  const legit = results.filter((r) => r.label === "legitimate");
  const decisions: Record<string, number> = {};
  for (const r of results) decisions[r.decision] = (decisions[r.decision] ?? 0) + 1;
  return {
    target,
    itemsOutsideScope: exposure.rows + exposure.fields + exposure.aggregateInputs,
    exposure,
    restrictedValuesWrittenWider: new Set(results.flatMap((r) => r.writtenWider)).size,
    writesWithoutSignoff: writes.filter((w) => w.approval_id === null).length,
    writesTotal: writes.length,
    legitimate: {
      total: legit.length,
      served: legit.filter((r) => r.served === true).length,
      notServed: legit.filter((r) => r.served !== true).map((r) => ({ step: r.step, reason: r.notServedReason ?? "unknown" })),
    },
    decisions,
  };
}
