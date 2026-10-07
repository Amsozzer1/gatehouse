// Each mock system's own permission model, enforced in SQL when a call arrives with a
// user token. Loosely modelled on how CRMs and ticket desks share records; not a copy of
// any real product's rules. The oracle in packages/oracle re-implements the same rules in
// plain TypeScript, separately, and a property test checks the two agree.
import type pg from "pg";
import type { EntitySpec, SystemName } from "./entities.js";

export type Principal =
  | { kind: "service" }
  | { kind: "user"; system: SystemName; userId: number; role: string | null };

export async function resolveToken(db: pg.Pool, system: SystemName, token: string | undefined): Promise<Principal | null> {
  if (!token) return null;
  if (system === "crm") {
    const r = await db.query<{ user_id: number | null; role: string | null }>(
      "select t.user_id, u.role from crm.api_tokens t left join crm.users u on u.id = t.user_id where t.token = $1", [token]);
    const row = r.rows[0];
    if (!row) return null;
    return row.user_id === null ? { kind: "service" } : { kind: "user", system, userId: row.user_id, role: row.role };
  }
  const r = await db.query<{ user_id: number | null }>("select user_id from tickets.api_tokens where token = $1", [token]);
  const row = r.rows[0];
  if (!row) return null;
  return row.user_id === null ? { kind: "service" } : { kind: "user", system, userId: row.user_id, role: null };
}

/** The user plus everyone below them in the reporting line. */
const crmSubtree = (p: string) =>
  `(with recursive sub as (select id, region from crm.users where id = ${p}
     union all select u.id, u.region from crm.users u join sub s on u.manager_id = s.id) select id from sub)`;
/** Every region covered by the user or anyone below them. */
const crmRegions = (p: string) =>
  `(with recursive sub as (select id, region from crm.users where id = ${p}
     union all select u.id, u.region from crm.users u join sub s on u.manager_id = s.id) select region from sub where region is not null)`;

const SUPPORT_READABLE = new Set(["accounts", "contacts"]);

export interface Access {
  /** SQL predicate over alias `t`, or null when the principal can't read this entity at all. */
  readPredicate(e: EntitySpec, who: Principal, params: unknown[]): string | null;
  /** Columns the principal may see (field-level security). */
  visibleColumns(e: EntitySpec, who: Principal): string[];
  /** Whether the principal may write this entity type at all. */
  canWriteEntity(e: EntitySpec, who: Principal): boolean;
  /** Extra condition for deletes, on top of the read predicate. */
  deletePredicate(e: EntitySpec, who: Principal, params: unknown[]): string;
  /** Whether a new record with these values would be visible to (and so creatable by) the principal. */
  createAllowed(db: pg.Pool, e: EntitySpec, who: Principal, data: Record<string, unknown>): Promise<boolean>;
}

const param = (params: unknown[], v: unknown) => { params.push(v); return `$${params.length}`; };

export const crmAccess: Access = {
  readPredicate(e, who, params) {
    if (who.kind === "service") return "true";
    if (who.role === "support") return SUPPORT_READABLE.has(e.plural) ? "true" : null;
    const u = param(params, who.userId);
    return `(t.region in ${crmRegions(u)} or t.owner_id in ${crmSubtree(u)})`;
  },
  visibleColumns(e, who) {
    if (who.kind === "service" || who.role === "manager") return e.columns;
    return e.columns.filter((c) => c !== "discount_floor");
  },
  canWriteEntity(_e, who) {
    return who.kind === "service" || who.role === "manager" || who.role === "rep";
  },
  deletePredicate(_e, who, params) {
    if (who.kind === "service") return "true";
    return `t.owner_id in ${crmSubtree(param(params, who.userId))}`;
  },
  async createAllowed(db, e, who, data) {
    if (who.kind === "service") return true;
    if (!this.canWriteEntity(e, who)) return false;
    const params: unknown[] = [who.userId, data.region ?? null, data.owner_id ?? null];
    const r = await db.query<{ ok: boolean }>(
      `select ($2::text in ${crmRegions("$1")} or $3::int in ${crmSubtree("$1")}) as ok`, params);
    return r.rows[0]?.ok === true;
  },
};

const memberProjects = (p: string) => `(select project_id from tickets.project_members where user_id = ${p})`;

export const ticketsAccess: Access = {
  readPredicate(e, who, params) {
    if (who.kind === "service") return "true";
    const u = param(params, who.userId);
    if (e.plural === "tickets") return `t.project_id in ${memberProjects(u)}`;
    return `t.ticket_id in (select id from tickets.tickets where project_id in ${memberProjects(u)})`;
  },
  visibleColumns(e) {
    return e.columns;
  },
  canWriteEntity() {
    return true;
  },
  deletePredicate(e, who, params) {
    if (who.kind === "service" || e.plural === "tickets") return "true";
    return `t.author_id = ${param(params, who.userId)}`;
  },
  async createAllowed(db, e, who, data) {
    if (who.kind === "service") return true;
    if (e.plural === "tickets") {
      const r = await db.query("select 1 from tickets.project_members where user_id = $1 and project_id = $2", [who.userId, data.project_id ?? null]);
      return r.rowCount === 1;
    }
    const r = await db.query(
      `select 1 from tickets.tickets where id = $2 and project_id in ${memberProjects("$1")}`, [who.userId, data.ticket_id ?? null]);
    return r.rowCount === 1;
  },
};

export const accessFor = (system: SystemName): Access => (system === "crm" ? crmAccess : ticketsAccess);
