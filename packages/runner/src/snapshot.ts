import type pg from "pg";
import type { EntityKey, Row, Snapshot } from "../../oracle/src/index.js";

const TABLES: EntityKey[] = ["crm.accounts", "crm.contacts", "crm.opportunities", "crm.activities", "tickets.tickets", "tickets.comments"];

/** Current rows of every table, read directly (the service view), for the oracle. */
export async function loadSnapshot(db: pg.Pool): Promise<Snapshot> {
  const out = {} as Snapshot;
  for (const t of TABLES) {
    const r = await db.query(`select * from ${t} order by id`);
    out[t] = new Map(r.rows.map((row: Row) => [row.id as number, row]));
  }
  return out;
}
