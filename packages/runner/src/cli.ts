// pnpm trace --target service|user|gateway [--observe]
// Replays the scripted session against one target on a fresh database and prints the counters.
import { generateWorld } from "../../systems/src/generator.js";
import { SEED } from "../../systems/src/config.js";
import { loadPolicy } from "../../gateway/src/policy.js";
import { loadTrace } from "./trace.js";
import { directTarget, type Target } from "./targets.js";
import { gatewayTarget } from "./gateway-target.js";
import { runTrace, summarize } from "./run.js";
import { startStack } from "./stack.js";

const argv = process.argv.slice(2);
const targetName = argv[argv.indexOf("--target") + 1];
if (!argv.includes("--target") || !["service", "user", "gateway"].includes(targetName ?? "")) {
  console.error("usage: pnpm trace --target service|user|gateway [--observe]");
  process.exit(2);
}

const world = generateWorld(SEED);
const policy = loadPolicy();
const trace = loadTrace();
const stack = await startStack(`gh_run_cli_${targetName}`);
let target: Target;
let approveHeld: ((id: number) => Promise<{ status: string; approver: number }>) | undefined;
if (targetName === "gateway") {
  const gw = await gatewayTarget({ world, policy, stack, mode: argv.includes("--observe") ? "observe" : "enforce" });
  target = gw;
  // Held writes are approved right after their step by the team's approver, as in pnpm measure.
  approveHeld = async (id) => ({ ...(await gw.approve(id, world.personas.approver)), approver: world.personas.approver });
} else {
  target = directTarget(targetName as "service" | "user", world, stack.urls);
}
try {
  const results = await runTrace({ target, world, trace, policy, db: stack.db, ...(approveHeld ? { approve: approveHeld } : {}) });
  for (const r of results) {
    const flag = r.ok ? (r.decision === "held" ? "HELD" : "ok  ") : "ERR ";
    console.log(`${flag} ${r.step.padEnd(24)} ${r.tool.padEnd(28)} out-of-scope=${r.exposure.rows + r.exposure.fields + r.exposure.aggregateInputs} writes=${r.writes.length}${r.served === false ? ` not-served: ${r.notServedReason}` : ""}`);
  }
  console.log(JSON.stringify(summarize(target.name, results), null, 2));
} finally {
  await target.close();
  await stack.close();
}
