// pnpm seeds: the headline counters on seeds 1-5, as a robustness check over different
// generated data (different people, deals and tickets; same trace and policy).
// Deterministic. Restores the seed-42 template when done.
import { writeFileSync } from "node:fs";
import { generateWorld } from "../packages/systems/src/generator.js";
import { createTemplate } from "../packages/systems/src/seed.js";
import { loadPolicy } from "../packages/gateway/src/policy.js";
import { loadTrace } from "../packages/runner/src/trace.js";
import { directTarget, type Target } from "../packages/runner/src/targets.js";
import { gatewayTarget } from "../packages/runner/src/gateway-target.js";
import { runTrace, summarize } from "../packages/runner/src/run.js";
import { startStack } from "../packages/runner/src/stack.js";

const policy = loadPolicy();
const trace = loadTrace();
const rows: Record<string, unknown>[] = [];

for (const seed of [1, 2, 3, 4, 5]) {
  const world = generateWorld(seed);
  await createTemplate(world);
  for (const key of ["service", "user", "gateway"] as const) {
    const stack = await startStack(`gh_run_seed_${key}`);
    let target: Target;
    let approve: Parameters<typeof runTrace>[0]["approve"];
    if (key === "gateway") {
      const g = await gatewayTarget({ world, policy, stack, mode: "enforce" });
      target = g;
      approve = async (id) => ({ ...(await g.approve(id, world.personas.approver)), approver: world.personas.approver });
    } else {
      target = directTarget(key, world, stack.urls);
    }
    try {
      const s = summarize(key, await runTrace({ target, world, trace, policy, db: stack.db, ...(approve ? { approve } : {}) }));
      rows.push({
        seed, target: key, itemsOutsideScope: s.itemsOutsideScope, beyondUser: s.exposure.beyondUser,
        restrictedValuesWrittenWider: s.restrictedValuesWrittenWider, writesWithoutSignoff: s.writesWithoutSignoff,
        writesTotal: s.writesTotal, legitimateServed: s.legitimate.served, legitimateTotal: s.legitimate.total,
      });
    } finally {
      await target.close();
      await stack.close();
    }
  }
}
await createTemplate(generateWorld(42));
writeFileSync(new URL("../results/seeds.json", import.meta.url), `${JSON.stringify(rows, null, 2)}\n`);
console.table(rows);
