// pnpm measure [--check]
// Replays the scripted session against all targets, each on a fresh copy of the seed
// database, computes every number in the README with the oracle, and writes results/.
// With --check, it fails if any deterministic number differs from the committed results.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { getEncoding } from "js-tiktoken";
import { generateWorld } from "../packages/systems/src/generator.js";
import { SEED } from "../packages/systems/src/config.js";
import { createTemplate } from "../packages/systems/src/seed.js";
import { loadPolicy } from "../packages/gateway/src/policy.js";
import { loadTrace } from "../packages/runner/src/trace.js";
import { directTarget, type Target, type TargetName } from "../packages/runner/src/targets.js";
import { gatewayTarget } from "../packages/runner/src/gateway-target.js";
import { runTrace, summarize, type RunSummary, type StepResult } from "../packages/runner/src/run.js";
import { startStack } from "../packages/runner/src/stack.js";
import { renderNumbers, renderReadme } from "./report.js";

const check = process.argv.includes("--check");
const out = new URL("../results/", import.meta.url);
mkdirSync(out, { recursive: true });

const world = generateWorld(SEED);
const policy = loadPolicy();
const trace = loadTrace();
const enc = getEncoding("cl100k_base");
await createTemplate(world);

type RunKey = "service" | "user" | "gateway" | "observe";
const runs: Record<RunKey, { summary: RunSummary; results: StepResult[]; tokens: Record<string, number>; toolCounts: Record<string, number> }> = {} as never;
let rollout: { bundle: string; decision: string; reason: string; n: number }[] = [];

for (const key of ["service", "user", "gateway", "observe"] as const) {
  const stack = await startStack(`gh_run_${key}`);
  let target: Target;
  let approve: Parameters<typeof runTrace>[0]["approve"];
  if (key === "gateway" || key === "observe") {
    const g = await gatewayTarget({ world, policy, stack, mode: key === "gateway" ? "enforce" : "observe" });
    target = g;
    if (key === "gateway") approve = async (id) => ({ ...(await g.approve(id, world.personas.approver)), approver: world.personas.approver });
  } else {
    target = directTarget(key, world, stack.urls);
  }
  try {
    const results = await runTrace({ target, world, trace, policy, db: stack.db, ...(approve ? { approve } : {}) });
    const name: TargetName = key === "observe" ? "gateway" : key;
    const tokens: Record<string, number> = {};
    const toolCounts: Record<string, number> = {};
    for (const [persona, p] of Object.entries(trace.personas)) {
      const tools = await target.listTools((world.personas as Record<string, number>)[persona]!, p.bundle);
      tokens[persona] = enc.encode(JSON.stringify(tools)).length;
      toolCounts[persona] = tools.length;
    }
    runs[key] = { summary: summarize(name, results), results, tokens, toolCounts };
    if (key === "observe") {
      const r = await stack.db.query<{ bundle: string; decision: string; reason: string; n: number }>(
        `select bundle, decision, reason, count(*)::int as n
         from gateway.audit_log, jsonb_array_elements_text(reasons) as reason
         where decision like 'would-%' and reason not like 'source-error%' and reason not like 'source-denied%'
         group by 1, 2, 3 order by 1, 2, 3`);
      const denied = await stack.db.query<{ bundle: string; n: number }>(
        `select bundle, count(*)::int as n from gateway.audit_log
         where reasons::text like '%source-denied%' group by 1 order by 1`);
      rollout = [...r.rows, ...denied.rows.map((d) => ({ bundle: d.bundle, decision: "would-deny", reason: "source-denied", n: d.n }))];
    }
  } finally {
    await target.close();
    await stack.close();
  }
}

const deterministic = {
  seed: SEED,
  steps: trace.steps.length,
  catalogTools: (await import("../packages/systems/src/tools.js")).TOOLS.length,
  targets: Object.fromEntries((["service", "user", "gateway"] as const).map((k) => [k, {
    itemsOutsideScope: runs[k].summary.itemsOutsideScope,
    exposure: runs[k].summary.exposure,
    restrictedValuesWrittenWider: runs[k].summary.restrictedValuesWrittenWider,
    writesWithoutSignoff: runs[k].summary.writesWithoutSignoff,
    writesTotal: runs[k].summary.writesTotal,
    legitimate: runs[k].summary.legitimate,
    decisions: runs[k].summary.decisions,
    toolTokens: runs[k].tokens,
  }])),
  observe: { rollout, decisions: runs.observe.summary.decisions, itemsOutsideScope: runs.observe.summary.itemsOutsideScope },
  gatewayCostOfScoping: runs.gateway.results
    .filter((r) => r.label === "legitimate" && r.reasons.length > 0)
    .map((r) => ({ step: r.step, decision: r.decision, reasons: r.reasons.filter((x) => !x.startsWith("source-")) })),
};

const summaryFile = new URL("summary.json", out);
const summaryText = `${JSON.stringify(deterministic, null, 2)}\n`;
if (check) {
  if (!existsSync(summaryFile)) throw new Error("results/summary.json is missing");
  const committed = readFileSync(summaryFile, "utf8");
  if (committed !== summaryText) {
    console.error("deterministic numbers differ from the committed results/summary.json");
    writeFileSync(new URL("summary.check.json", out), summaryText);
    process.exit(1);
  }
  console.log("results/summary.json matches");
  process.exit(0);
}

writeFileSync(summaryFile, summaryText);
for (const k of ["service", "user", "gateway", "observe"] as const) {
  writeFileSync(new URL(`run-${k}.jsonl`, out), runs[k].results.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

// Compact data for the replay page: one row per step, one cell per target.
const replay = {
  seed: SEED,
  personas: trace.personas,
  tokens: { service: runs.service.tokens, user: runs.user.tokens, gateway: runs.gateway.tokens },
  toolCounts: { service: runs.service.toolCounts, user: runs.user.toolCounts, gateway: runs.gateway.toolCounts },
  steps: trace.steps.map((s, i) => ({
    id: s.id, persona: s.persona, say: s.say, tool: s.tool, label: s.label,
    cells: Object.fromEntries((["service", "user", "gateway"] as const).map((k) => {
      const r = runs[k].results[i]!;
      return [k, {
        ok: r.ok, decision: r.decision, error: r.error ? r.error.slice(0, 120) : null,
        items: r.exposure.rows + r.exposure.fields + r.exposure.aggregateInputs,
        beyondUser: r.exposure.beyondUser,
        writtenWider: [...new Set(r.writtenWider)].length,
        unsignedWrites: r.writes.filter((w) => w.approval_id === null).length,
        signedWrites: r.writes.filter((w) => w.approval_id !== null).length,
        returned: r.data ? ((r.data.rows as unknown[] | undefined)?.length ?? (r.data.row ? 1 : 0)) : 0,
        approval: r.approval?.status ?? null,
      }];
    })),
  })),
};
mkdirSync(new URL("../apps/web/public/", import.meta.url), { recursive: true });
writeFileSync(new URL("replay.json", out), `${JSON.stringify(replay, null, 2)}\n`);
writeFileSync(new URL("../apps/web/public/replay.json", import.meta.url), `${JSON.stringify(replay)}\n`);

writeFileSync(new URL("numbers.md", out), renderNumbers(deterministic));
const readmeUrl = new URL("../README.md", import.meta.url);
writeFileSync(readmeUrl, renderReadme(readFileSync(readmeUrl, "utf8"), deterministic, replay));
console.log(JSON.stringify(deterministic.targets, null, 2));
