import { describe, expect, it } from "vitest";
import { generateWorld } from "../packages/systems/src/generator.js";
import { loadPolicy } from "../packages/gateway/src/policy.js";
import { loadTrace } from "../packages/runner/src/trace.js";
import { directTarget } from "../packages/runner/src/targets.js";
import { runTrace, summarize } from "../packages/runner/src/run.js";
import { startStack } from "../packages/runner/src/stack.js";

const world = generateWorld(42);
const policy = loadPolicy();
const trace = loadTrace();

async function runDirect(name: "service" | "user", db: string) {
  const stack = await startStack(db);
  const target = directTarget(name, world, stack.urls);
  try {
    const results = await runTrace({ target, world, trace, policy, db: stack.db });
    return { results, summary: summarize(name, results) };
  } finally {
    await target.close();
    await stack.close();
  }
}

describe("direct baselines", () => {
  it("service account exposes records beyond the user's own permissions", async () => {
    const { summary } = await runDirect("service", "gh_test_run_service");
    expect(summary.exposure.beyondUser).toBeGreaterThan(0);
    expect(summary.writesWithoutSignoff).toBeGreaterThan(0);
  });

  it("per-user tokens stop leaks beyond the user, but not beyond the team's scope or unsupervised writes", async () => {
    const { summary } = await runDirect("user", "gh_test_run_user");
    expect(summary.exposure.beyondUser).toBe(0);
    expect(summary.itemsOutsideScope).toBeGreaterThan(0);
    expect(summary.restrictedValuesWrittenWider).toBeGreaterThan(0);
    expect(summary.writesWithoutSignoff).toBeGreaterThan(0);
  });

  it("gives identical results for the same seed twice", async () => {
    const a = await runDirect("user", "gh_test_det_a");
    const b = await runDirect("user", "gh_test_det_b");
    expect(JSON.stringify(a.results)).toBe(JSON.stringify(b.results));
  });
});
