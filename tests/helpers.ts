import pg from "pg";
import { createPool } from "../packages/systems/src/db.js";
import { createRunDb, dropRunDb, SERVICE_TOKENS } from "../packages/systems/src/seed.js";
import { startSystem } from "../packages/systems/src/server.js";
import { connectClient } from "../packages/systems/src/mcp-http.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

export const TEST_EXECUTOR_SECRET = "test-executor-secret";

export interface SystemsStack {
  dbName: string;
  pool: pg.Pool;
  urls: { crm: string; tickets: string };
  client(system: "crm" | "tickets", token: string, extra?: Record<string, string>): Promise<Client>;
  service(system: "crm" | "tickets"): Promise<Client>;
  close(): Promise<void>;
}

export async function startSystemsStack(dbName: string): Promise<SystemsStack> {
  const url = await createRunDb(dbName);
  const pool = createPool(url);
  const crm = await startSystem({ system: "crm", db: pool, executorSecret: TEST_EXECUTOR_SECRET });
  const tickets = await startSystem({ system: "tickets", db: pool, executorSecret: TEST_EXECUTOR_SECRET });
  const clients: Client[] = [];
  const client = async (system: "crm" | "tickets", token: string, extra: Record<string, string> = {}) => {
    const c = await connectClient(system === "crm" ? crm.url : tickets.url, { authorization: `Bearer ${token}`, ...extra });
    clients.push(c);
    return c;
  };
  return {
    dbName,
    pool,
    urls: { crm: crm.url, tickets: tickets.url },
    client,
    service: (system) => client(system, SERVICE_TOKENS[system]),
    async close() {
      await Promise.all(clients.map((c) => c.close()));
      await crm.close();
      await tickets.close();
      await pool.end();
      await dropRunDb(dbName);
    },
  };
}
