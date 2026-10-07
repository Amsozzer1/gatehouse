// pnpm stack [--observe]: a fresh copy of the seed database, both mock systems and the
// gateway on fixed local ports, running until Ctrl-C. Use it with any MCP client, and
// with `pnpm approve` / `pnpm reject` for held writes.
import { generateWorld } from "../packages/systems/src/generator.js";
import { SEED } from "../packages/systems/src/config.js";
import { createPool } from "../packages/systems/src/db.js";
import { createRunDb, personaToken } from "../packages/systems/src/seed.js";
import { startSystem } from "../packages/systems/src/server.js";
import { loadPolicy } from "../packages/gateway/src/policy.js";
import { startGateway } from "../packages/gateway/src/gateway.js";
import { DEV_DB, DEV_PORTS, devExecutorSecret } from "../packages/gateway/src/dev.js";

const world = generateWorld(SEED);
const policy = loadPolicy();
const db = createPool(await createRunDb(DEV_DB));
const executorSecret = devExecutorSecret(true);
const crm = await startSystem({ system: "crm", db, executorSecret, port: DEV_PORTS.crm });
const tickets = await startSystem({ system: "tickets", db, executorSecret, port: DEV_PORTS.tickets });
const mode = process.argv.includes("--observe") ? "observe" : "enforce";
const gateway = await startGateway({ db, policy, upstreams: { crm: crm.url, tickets: tickets.url }, mode, port: DEV_PORTS.gateway });

console.log(`database   ${DEV_DB} (fresh copy of the seed, seed ${SEED})`);
console.log(`crm        ${crm.url}`);
console.log(`tickets    ${tickets.url}`);
for (const name of Object.keys(policy.bundles)) console.log(`gateway    ${gateway.bundleUrl(name)}  (${mode})`);
console.log("\npersona tokens (fake, for this mock only):");
for (const [name, id] of Object.entries(world.personas)) console.log(`  ${name.padEnd(9)} person ${id}  Bearer ${personaToken(id)}`);
console.log("\nCtrl-C to stop.");

const stop = async () => {
  await gateway.close();
  await crm.close();
  await tickets.close();
  await db.end();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
