// The tool catalog is generated: one factory over an entity x verb table, plus four
// hand-written tools. Every read tool honours `region` (where the entity has one),
// `fields` and `limit`; every write tool accepts `dry_run`.
import type pg from "pg";
import { REGIONS } from "./generator.js";
import { ENTITIES, entity, type EntitySpec, type SystemName } from "./entities.js";
import { accessFor, type Principal } from "./access.js";

export type ToolKind = "read" | "aggregate" | "write";
export type Json = Record<string, unknown>;

export interface ToolContext {
  db: pg.Pool;
  who: Principal;
  /** Set only when the approval executor presented the executor secret. */
  approvalId: number | null;
}

export interface ToolDef {
  name: string;
  system: SystemName;
  kind: ToolKind;
  entity: string;
  description: string;
  inputSchema: Json;
  run(ctx: ToolContext, args: Json): Promise<Json>;
}

export class ToolError extends Error {}

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

/** Users the mock systems attribute service-account writes to. */
export const SERVICE_ACTOR = { crm: null, tickets: 9000 } as const;

function int(v: unknown, name: string): number {
  if (typeof v !== "number" || !Number.isInteger(v)) throw new ToolError(`${name} must be an integer`);
  return v;
}

function readArgs(e: EntitySpec, args: Json) {
  const fields = Array.isArray(args.fields) ? args.fields.filter((f): f is string => typeof f === "string") : null;
  const region = typeof args.region === "string" ? args.region : null;
  const limit = args.limit === undefined ? DEFAULT_LIMIT : Math.min(int(args.limit, "limit"), MAX_LIMIT);
  const offset = args.offset === undefined ? 0 : int(args.offset, "offset");
  if (region !== null && !e.hasRegion) throw new ToolError(`${e.plural} have no region`);
  return { fields, region, limit, offset };
}

function projection(e: EntitySpec, who: Principal, fields: string[] | null): string[] {
  const visible = accessFor(e.system).visibleColumns(e, who);
  if (!fields) return visible;
  return visible.filter((c) => c === "id" || fields.includes(c));
}

const quote = (cols: string[]) => cols.map((c) => `t.${c}`).join(", ");

async function logWrite(ctx: ToolContext, e: EntitySpec, action: string, recordId: number | null, data: Json): Promise<void> {
  const actor = ctx.who.kind === "user" ? ctx.who.userId : SERVICE_ACTOR[e.system];
  await ctx.db.query(
    "insert into public.write_log (system, entity, record_id, action, data, actor_user_id, approval_id) values ($1,$2,$3,$4,$5,$6,$7)",
    [e.system, e.plural, recordId, action, JSON.stringify(data), actor, ctx.approvalId]);
}

/** Loads one record the principal can read, or throws not found. */
async function readable(ctx: ToolContext, e: EntitySpec, id: number, region: string | null = null): Promise<Json> {
  const params: unknown[] = [id];
  const pred = accessFor(e.system).readPredicate(e, ctx.who, params);
  if (pred === null) throw new ToolError(`permission denied: cannot access ${e.plural}`);
  let extra = "";
  if (region !== null) { params.push(region); extra = `and t.region = $${params.length}`; }
  const r = await ctx.db.query(`select t.* from ${e.table} t where t.id = $1 and ${pred} ${extra}`, params);
  if (!r.rows[0]) throw new ToolError(`not found: ${e.singular} ${id}`);
  return r.rows[0] as Json;
}

function writableData(e: EntitySpec, data: unknown): Json {
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new ToolError("data must be an object");
  for (const k of Object.keys(data)) if (!e.writable.includes(k)) throw new ToolError(`field ${k} is not writable`);
  return data as Json;
}

function project(row: Json, cols: string[]): Json {
  return Object.fromEntries(cols.filter((c) => c in row).map((c) => [c, row[c]]));
}

function factoryTools(e: EntitySpec): ToolDef[] {
  const access = accessFor(e.system);
  const prefix = e.system;
  const fieldsSchema = { type: "array", items: { type: "string", enum: e.columns }, description: "Columns to return. id is always included." };
  const regionSchema = e.hasRegion ? { region: { type: "string", enum: [...REGIONS], description: "Only records in this region." } } : {};
  const filterSchema = Object.fromEntries(e.filterable.map((c) => [c, { description: `Exact match on ${c}.` }]));
  const pageSchema = {
    limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT, description: `Max rows (default ${DEFAULT_LIMIT}).` },
    offset: { type: "integer", minimum: 0 },
  };
  const dryRun = { dry_run: { type: "boolean", description: "Check permission and validate without writing." } };

  const list: ToolDef = {
    name: `${prefix}_list_${e.plural}`, system: e.system, kind: "read", entity: e.plural,
    description: `List ${e.plural} visible to the caller, ordered by id. Filter by ${[...(e.hasRegion ? ["region"] : []), ...e.filterable].join(", ")}.`,
    inputSchema: { type: "object", properties: { ...regionSchema, ...filterSchema, fields: fieldsSchema, ...pageSchema }, additionalProperties: false },
    async run(ctx, args) {
      const { fields, region, limit, offset } = readArgs(e, args);
      const params: unknown[] = [];
      const pred = access.readPredicate(e, ctx.who, params);
      if (pred === null) throw new ToolError(`permission denied: cannot access ${e.plural}`);
      const where = [pred];
      if (region !== null) { params.push(region); where.push(`t.region = $${params.length}`); }
      for (const c of e.filterable) if (args[c] !== undefined) { params.push(args[c]); where.push(`t.${c} = $${params.length}`); }
      const cols = projection(e, ctx.who, fields);
      const r = await ctx.db.query(
        `select ${quote(cols)} from ${e.table} t where ${where.join(" and ")} order by t.id limit ${limit} offset ${offset}`, params);
      return { rows: r.rows };
    },
  };

  const get: ToolDef = {
    name: `${prefix}_get_${e.singular}`, system: e.system, kind: "read", entity: e.plural,
    description: `Get one ${e.singular} by id.`,
    inputSchema: { type: "object", properties: { id: { type: "integer" }, ...regionSchema, fields: fieldsSchema }, required: ["id"], additionalProperties: false },
    async run(ctx, args) {
      const { fields, region } = readArgs(e, args);
      const row = await readable(ctx, e, int(args.id, "id"), region);
      return { row: project(row, projection(e, ctx.who, fields)) };
    },
  };

  const search: ToolDef = {
    name: `${prefix}_search_${e.plural}`, system: e.system, kind: "read", entity: e.plural,
    description: `Search ${e.plural} by text in ${e.searchable.join(", ")}.`,
    inputSchema: { type: "object", properties: { query: { type: "string" }, ...regionSchema, fields: fieldsSchema, ...pageSchema }, required: ["query"], additionalProperties: false },
    async run(ctx, args) {
      const { fields, region, limit, offset } = readArgs(e, args);
      if (typeof args.query !== "string") throw new ToolError("query must be a string");
      const params: unknown[] = [];
      const pred = access.readPredicate(e, ctx.who, params);
      if (pred === null) throw new ToolError(`permission denied: cannot access ${e.plural}`);
      params.push(`%${args.query}%`);
      const q = `$${params.length}`;
      const where = [pred, `(${e.searchable.map((c) => `t.${c} ilike ${q}`).join(" or ")})`];
      if (region !== null) { params.push(region); where.push(`t.region = $${params.length}`); }
      const cols = projection(e, ctx.who, fields);
      const r = await ctx.db.query(
        `select ${quote(cols)} from ${e.table} t where ${where.join(" and ")} order by t.id limit ${limit} offset ${offset}`, params);
      return { rows: r.rows };
    },
  };

  const create: ToolDef = {
    name: `${prefix}_create_${e.singular}`, system: e.system, kind: "write", entity: e.plural,
    description: `Create a ${e.singular}.`,
    inputSchema: { type: "object", properties: { data: { type: "object" }, ...dryRun }, required: ["data"], additionalProperties: false },
    async run(ctx, args) {
      const data = writableData(e, args.data);
      if (!access.canWriteEntity(e, ctx.who) || !(await access.createAllowed(ctx.db, e, ctx.who, data))) {
        throw new ToolError(`permission denied: cannot create this ${e.singular}`);
      }
      if (args.dry_run === true) return { ok: true, dry_run: true };
      const cols = Object.keys(data);
      const r = await ctx.db.query(
        `insert into ${e.table} (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")}) returning *`,
        cols.map((c) => data[c]));
      const row = r.rows[0] as Json;
      await logWrite(ctx, e, "create", row.id as number, data);
      return { ok: true, row: project(row, projection(e, ctx.who, null)) };
    },
  };

  const update: ToolDef = {
    name: `${prefix}_update_${e.singular}`, system: e.system, kind: "write", entity: e.plural,
    description: `Update fields on a ${e.singular}.`,
    inputSchema: { type: "object", properties: { id: { type: "integer" }, data: { type: "object" }, ...dryRun }, required: ["id", "data"], additionalProperties: false },
    async run(ctx, args) {
      return updateRecord(ctx, e, int(args.id, "id"), writableData(e, args.data), args.dry_run === true);
    },
  };

  const del: ToolDef = {
    name: `${prefix}_delete_${e.singular}`, system: e.system, kind: "write", entity: e.plural,
    description: `Delete a ${e.singular}.`,
    inputSchema: { type: "object", properties: { id: { type: "integer" }, ...dryRun }, required: ["id"], additionalProperties: false },
    async run(ctx, args) {
      const id = int(args.id, "id");
      await readable(ctx, e, id);
      if (!access.canWriteEntity(e, ctx.who)) throw new ToolError(`permission denied: cannot delete ${e.plural}`);
      const params: unknown[] = [id];
      const own = access.deletePredicate(e, ctx.who, params);
      const ok = await ctx.db.query(`select 1 from ${e.table} t where t.id = $1 and ${own}`, params);
      if (ok.rowCount !== 1) throw new ToolError(`permission denied: cannot delete ${e.singular} ${id}`);
      if (args.dry_run === true) return { ok: true, dry_run: true };
      await ctx.db.query(`delete from ${e.table} where id = $1`, [id]);
      await logWrite(ctx, e, "delete", id, {});
      return { ok: true };
    },
  };

  return [list, get, search, create, update, del];
}

async function updateRecord(ctx: ToolContext, e: EntitySpec, id: number, data: Json, dryRun: boolean): Promise<Json> {
  await readable(ctx, e, id);
  if (!accessFor(e.system).canWriteEntity(e, ctx.who)) throw new ToolError(`permission denied: cannot update ${e.plural}`);
  if (dryRun) return { ok: true, dry_run: true };
  const cols = Object.keys(data);
  if (cols.length === 0) throw new ToolError("nothing to update");
  const r = await ctx.db.query(
    `update ${e.table} set ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")} where id = $1 returning *`,
    [id, ...cols.map((c) => data[c])]);
  await logWrite(ctx, e, "update", id, data);
  return { ok: true, row: project(r.rows[0] as Json, projection(e, ctx.who, null)) };
}

function handWritten(): ToolDef[] {
  const opps = entity("crm", "opportunities");
  const comments = entity("tickets", "comments");
  const tickets = entity("tickets", "tickets");
  const dryRun = { dry_run: { type: "boolean", description: "Check permission and validate without writing." } };
  return [
    {
      name: "crm_pipeline_summary", system: "crm", kind: "aggregate", entity: "opportunities",
      description: "Pipeline by stage: count, total amount and lowest discount floor of the opportunities visible to the caller.",
      inputSchema: {
        type: "object",
        properties: {
          region: { type: "string", enum: [...REGIONS] }, close_quarter: { type: "string", description: "e.g. 2026-Q3" },
          fields: { type: "array", items: { type: "string", enum: opps.columns }, description: "Source columns allowed in the output. Without amount, total_amount is omitted; without discount_floor, min_discount_floor is omitted." },
        },
        additionalProperties: false,
      },
      async run(ctx, args) {
        const { fields, region } = readArgs(opps, args);
        const params: unknown[] = [];
        const pred = accessFor("crm").readPredicate(opps, ctx.who, params);
        if (pred === null) throw new ToolError("permission denied: cannot access opportunities");
        const where = [pred];
        if (region !== null) { params.push(region); where.push(`t.region = $${params.length}`); }
        if (args.close_quarter !== undefined) { params.push(args.close_quarter); where.push(`t.close_quarter = $${params.length}`); }
        const visible = accessFor("crm").visibleColumns(opps, ctx.who);
        const allow = (c: string) => !fields || fields.includes(c);
        const r = await ctx.db.query<{ stage: string; count: number; total_amount: string; min_discount_floor: string }>(
          `select t.stage, count(*)::int as count, sum(t.amount)::bigint::text as total_amount, min(t.discount_floor)::text as min_discount_floor
           from crm.opportunities t where ${where.join(" and ")} group by t.stage order by t.stage`, params);
        return {
          rows: r.rows.map((row) => {
            const out: Json = { stage: row.stage, count: row.count };
            if (allow("amount")) out.total_amount = visible.includes("amount") ? Number(row.total_amount) : null;
            if (allow("discount_floor")) out.min_discount_floor = visible.includes("discount_floor") ? row.min_discount_floor : null;
            return out;
          }),
        };
      },
    },
    {
      name: "crm_close_opportunity", system: "crm", kind: "write", entity: "opportunities",
      description: "Mark an opportunity as closed won.",
      inputSchema: { type: "object", properties: { id: { type: "integer" }, ...dryRun }, required: ["id"], additionalProperties: false },
      async run(ctx, args) {
        return updateRecord(ctx, opps, int(args.id, "id"), { stage: "closed_won" }, args.dry_run === true);
      },
    },
    {
      name: "tickets_add_comment", system: "tickets", kind: "write", entity: "comments",
      description: "Add a comment to a ticket. Everyone in the ticket's project can read it.",
      inputSchema: { type: "object", properties: { ticket_id: { type: "integer" }, body: { type: "string" }, ...dryRun }, required: ["ticket_id", "body"], additionalProperties: false },
      async run(ctx, args) {
        const ticketId = int(args.ticket_id, "ticket_id");
        if (typeof args.body !== "string") throw new ToolError("body must be a string");
        if (!(await accessFor("tickets").createAllowed(ctx.db, comments, ctx.who, { ticket_id: ticketId }))) {
          throw new ToolError(`permission denied: cannot comment on ticket ${ticketId}`);
        }
        if (args.dry_run === true) return { ok: true, dry_run: true };
        const author = ctx.who.kind === "user" ? ctx.who.userId : SERVICE_ACTOR.tickets;
        const r = await ctx.db.query("insert into tickets.comments (ticket_id, author_id, body) values ($1,$2,$3) returning *", [ticketId, author, args.body]);
        const row = r.rows[0] as Json;
        await logWrite(ctx, comments, "create", row.id as number, { ticket_id: ticketId, body: args.body });
        return { ok: true, row };
      },
    },
    {
      name: "tickets_update_status", system: "tickets", kind: "write", entity: "tickets",
      description: "Change a ticket's status.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "integer" }, status: { type: "string", enum: ["open", "in_progress", "waiting", "resolved"] }, ...dryRun },
        required: ["id", "status"], additionalProperties: false,
      },
      async run(ctx, args) {
        if (typeof args.status !== "string") throw new ToolError("status must be a string");
        return updateRecord(ctx, tickets, int(args.id, "id"), { status: args.status }, args.dry_run === true);
      },
    },
  ];
}

export const TOOLS: ToolDef[] = [...ENTITIES.flatMap(factoryTools), ...handWritten()];
export const toolsFor = (system: SystemName) => TOOLS.filter((t) => t.system === system);
export const toolByName = (name: string) => TOOLS.find((t) => t.name === name);
