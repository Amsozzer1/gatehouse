// pnpm approve <id> --as <person>   /   pnpm reject <id> --as <person>
// Works against the stack started by `pnpm stack`. <person> is a person id or a persona
// name from the scripted session (rep, manager, support, approver).
import { generateWorld } from "../../systems/src/generator.js";
import { SEED } from "../../systems/src/config.js";
import { createPool } from "../../systems/src/db.js";
import { loadPolicy } from "./policy.js";
import { approve, reject, ApprovalError } from "./approvals.js";
import { devDatabaseUrl, devExecutorSecret, devUpstreams } from "./dev.js";

const [action, idArg, ...rest] = process.argv.slice(2);
const asArg = rest[rest.indexOf("--as") + 1];
if (!["approve", "reject"].includes(action ?? "") || !idArg || !/^\d+$/.test(idArg) || !rest.includes("--as") || !asArg) {
  console.error("usage: pnpm approve|reject <approval id> --as <person id | rep | manager | support | approver>");
  process.exit(2);
}
const personas = generateWorld(SEED).personas as Record<string, number>;
const person = /^\d+$/.test(asArg) ? Number(asArg) : personas[asArg];
if (person === undefined) {
  console.error(`unknown person ${asArg}`);
  process.exit(2);
}

const db = createPool(devDatabaseUrl());
const opts = { db, policy: loadPolicy(), upstreams: devUpstreams(), executorSecret: devExecutorSecret() };
try {
  const out = action === "approve" ? await approve(opts, Number(idArg), person) : await reject(opts, Number(idArg), person);
  console.log(JSON.stringify(out, null, 2));
} catch (err) {
  if (!(err instanceof ApprovalError)) throw err;
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
