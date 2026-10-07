import { randomBytes } from "node:crypto";
import type pg from "pg";
import { createPool } from "../../systems/src/db.js";
import { createRunDb, dropRunDb } from "../../systems/src/seed.js";
import { startSystem } from "../../systems/src/server.js";
import type { RunningServer } from "../../systems/src/mcp-http.js";

export interface Stack {
  dbName: string;
  db: pg.Pool;
  urls: { crm: string; tickets: string };
  executorSecret: string;
  close(opts?: { keepDb?: boolean }): Promise<void>;
}

/**
 * A fresh copy of the seed database plus both mock systems, in this process.
 * Each run gets its own database, so no run sees another run's writes.
 */
export async function startStack(dbName: string): Promise<Stack> {
  const db = createPool(await createRunDb(dbName));
  const executorSecret = randomBytes(16).toString("hex");
  const servers: RunningServer[] = [];
  const crm = await startSystem({ system: "crm", db, executorSecret });
  servers.push(crm);
  const tickets = await startSystem({ system: "tickets", db, executorSecret });
  servers.push(tickets);
  return {
    dbName,
    db,
    urls: { crm: crm.url, tickets: tickets.url },
    executorSecret,
    async close(opts) {
      for (const s of servers) await s.close();
      await db.end();
      if (!opts?.keepDb) await dropRunDb(dbName);
    },
  };
}
