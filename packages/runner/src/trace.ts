import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { World } from "../../systems/src/generator.js";
import { AGGREGATE_SOURCES } from "../../oracle/src/index.js";

export type Json = Record<string, unknown>;

export interface Need {
  entity?: string;
  where?: Json;
  search?: string;
  fields?: string[];
  aggregate?: boolean;
  first?: boolean;
  write?: boolean;
}

export interface TraceStep {
  id: string;
  persona: string;
  say: string;
  tool: string;
  args: Json;
  label: "legitimate" | "out-of-policy";
  need?: Need;
}

export interface Trace {
  personas: Record<string, { bundle: string; label: string }>;
  steps: TraceStep[];
}

export interface Tagged {
  value: string;
  /** The restricted source column the value came from. */
  source: string;
}

const RESTRICTED_SOURCES = new Set(["discount_floor"]);

export function loadTrace(path = new URL("../../../traces/session.yaml", import.meta.url)): Trace {
  const t = parse(readFileSync(path, "utf8")) as Trace;
  const ids = new Set<string>();
  for (const s of t.steps) {
    if (ids.has(s.id)) throw new Error(`duplicate step ${s.id}`);
    ids.add(s.id);
    if (!t.personas[s.persona]) throw new Error(`step ${s.id}: unknown persona ${s.persona}`);
    if (s.label === "legitimate" && !s.need) throw new Error(`step ${s.id}: legitimate steps need a need`);
  }
  return t;
}

/** Resolves $seed selectors, persona references and $from templates in step arguments. */
export class Resolver {
  constructor(private readonly world: World, private readonly outputs: Map<string, Json | null>) {}

  private personaCrmId(name: string): number {
    const id = (this.world.personas as Record<string, number>)[name];
    const p = this.world.people.find((x) => x.id === id);
    if (!p) throw new Error(`unknown persona ${name}`);
    return p.crmUserId;
  }

  private seedRows(entity: string): Json[] {
    const w = this.world;
    const map: Record<string, Json[]> = {
      "crm.accounts": w.crm.accounts as unknown as Json[], "crm.contacts": w.crm.contacts as unknown as Json[],
      "crm.opportunities": w.crm.opportunities as unknown as Json[], "crm.activities": w.crm.activities as unknown as Json[],
      "tickets.tickets": w.tickets.tickets as unknown as Json[], "tickets.comments": w.tickets.comments as unknown as Json[],
    };
    const rows = map[entity];
    if (!rows) throw new Error(`unknown seed entity ${entity}`);
    return rows;
  }

  matches(row: Json, where: Json): boolean {
    return Object.entries(where).every(([k, want]) => (Array.isArray(want) ? want.includes(row[k]) : row[k] === want));
  }

  private seed(spec: Json): unknown {
    const what = spec.$seed as string;
    if (what === "target.escalationTicket") return this.world.targets.escalationTicketId;
    const where = this.resolve(spec.where ?? {}).value as Json;
    let rows = this.seedRows(what).filter((r) => this.matches(r, where));
    const order = spec.order as string | undefined;
    if (order) {
      const desc = order.startsWith("-");
      const key = order.replace(/^-/, "");
      rows = [...rows].sort((a, b) => ((a[key] as number) - (b[key] as number)) * (desc ? -1 : 1) || (a.id as number) - (b.id as number));
    }
    const row = rows[(spec.nth as number | undefined) ?? 0];
    if (!row) throw new Error(`$seed ${what} matched nothing for ${JSON.stringify(where)}`);
    return row[(spec.field as string | undefined) ?? "id"];
  }

  private from(spec: Json, tagged: Tagged[]): string {
    const out = this.outputs.get(spec.$from as string);
    const rows = (out?.[(spec.each as string | undefined) ?? "rows"] as Json[] | undefined) ?? [];
    const parts = rows.map((row) => (spec.template as string).replace(/\{(\w+)\}/g, (_m, field: string) => {
      const v = row[field];
      if (v === null || v === undefined) return "";
      const text = String(v);
      const source = AGGREGATE_SOURCES[field] ?? field;
      if (RESTRICTED_SOURCES.has(source)) tagged.push({ value: text, source });
      return text;
    }));
    return `${(spec.prefix as string | undefined) ?? ""}${parts.join((spec.join as string | undefined) ?? "\n")}`;
  }

  resolve(value: unknown): { value: unknown; tagged: Tagged[] } {
    const tagged: Tagged[] = [];
    const walk = (v: unknown): unknown => {
      if (typeof v === "string" && v.startsWith("persona:")) return this.personaCrmId(v.slice("persona:".length));
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === "object") {
        const o = v as Json;
        if ("$seed" in o) return this.seed(o);
        if ("$from" in o) return this.from(o, tagged);
        return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, walk(x)]));
      }
      return v;
    };
    return { value: walk(value), tagged };
  }
}
