// Shared settings for the long-running local stack (pnpm stack) and the approval CLI.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { databaseUrl, urlForDatabase } from "../../systems/src/db.js";

export const DEV_DB = "gh_run_dev";
export const DEV_PORTS = {
  gateway: Number(process.env.GATEWAY_PORT ?? 7100),
  crm: Number(process.env.CRM_PORT ?? 7101),
  tickets: Number(process.env.TICKETS_PORT ?? 7102),
};
export const devUpstreams = () => ({
  crm: `http://127.0.0.1:${DEV_PORTS.crm}/mcp`,
  tickets: `http://127.0.0.1:${DEV_PORTS.tickets}/mcp`,
});
export const devDatabaseUrl = () => urlForDatabase(DEV_DB, databaseUrl());

const SECRET_FILE = new URL("../../../data/dev-executor-secret", import.meta.url);

/** The executor secret for the local stack: from EXECUTOR_SECRET, or generated once into data/ (gitignored). */
export function devExecutorSecret(create = false): string {
  if (process.env.EXECUTOR_SECRET) return process.env.EXECUTOR_SECRET;
  if (existsSync(SECRET_FILE)) return readFileSync(SECRET_FILE, "utf8").trim();
  if (!create) throw new Error("no executor secret: start the stack with `pnpm stack` first, or set EXECUTOR_SECRET");
  mkdirSync(new URL(".", SECRET_FILE), { recursive: true });
  const secret = randomBytes(16).toString("hex");
  writeFileSync(SECRET_FILE, `${secret}\n`, { mode: 0o600 });
  return secret;
}
