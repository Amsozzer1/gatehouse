// pnpm latency: wall-clock time of one read call (crm_get_account as the EMEA rep),
// per-user token straight to the CRM vs the same call through the gateway, on one machine
// over loopback. 100 warm-up calls, then 1,000 timed calls, 5 runs per path. The gateway
// path includes its audit-log insert. Not deterministic, so not part of `measure --check`.
import { writeFileSync } from "node:fs";
import { cpus, totalmem, platform, release } from "node:os";
import { generateWorld } from "../packages/systems/src/generator.js";
import { SEED } from "../packages/systems/src/config.js";
import { createTemplate, personaToken, userToken } from "../packages/systems/src/seed.js";
import { callJson, connectClient } from "../packages/systems/src/mcp-http.js";
import { loadPolicy } from "../packages/gateway/src/policy.js";
import { startGateway } from "../packages/gateway/src/gateway.js";
import { startStack } from "../packages/runner/src/stack.js";

const WARMUP = 100;
const CALLS = 1000;
const RUNS = 5;

const world = generateWorld(SEED);
await createTemplate(world);
const rep = world.people.find((p) => p.id === world.personas.rep)!;
const accountId = world.crm.accounts.find((a) => a.owner_id === rep.crmUserId)!.id;
const stack = await startStack("gh_run_latency");
const gateway = await startGateway({ db: stack.db, policy: loadPolicy(), upstreams: stack.urls, mode: "enforce" });
const direct = await connectClient(stack.urls.crm, { authorization: `Bearer ${userToken("crm", rep.crmUserId)}` });
const viaGateway = await connectClient(gateway.bundleUrl("emea-sales"), { authorization: `Bearer ${personaToken(rep.id)}` });

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};
const round = (x: number) => Math.round(x * 100) / 100;

async function time(client: typeof direct): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < CALLS; i++) {
    const t = performance.now();
    const r = await callJson(client, "crm_get_account", { id: accountId });
    out.push(performance.now() - t);
    if (!r.ok) throw new Error(r.error);
  }
  return out;
}

for (let i = 0; i < WARMUP; i++) {
  await callJson(direct, "crm_get_account", { id: accountId });
  await callJson(viaGateway, "crm_get_account", { id: accountId });
}
const all = { direct: [] as number[], gateway: [] as number[] };
const perRun: { run: number; directMedian: number; gatewayMedian: number; directP95: number; gatewayP95: number }[] = [];
for (let run = 1; run <= RUNS; run++) {
  // Alternate which path goes first, so neither always runs on a warmer process.
  const [a, b] = run % 2 ? (["direct", "gateway"] as const) : (["gateway", "direct"] as const);
  const res: Record<string, number[]> = {};
  res[a] = await time(a === "direct" ? direct : viaGateway);
  res[b] = await time(b === "direct" ? direct : viaGateway);
  all.direct.push(...res.direct!);
  all.gateway.push(...res.gateway!);
  perRun.push({
    run, directMedian: round(pct(res.direct!, 50)), gatewayMedian: round(pct(res.gateway!, 50)),
    directP95: round(pct(res.direct!, 95)), gatewayP95: round(pct(res.gateway!, 95)),
  });
}
await direct.close();
await viaGateway.close();
await gateway.close();
await stack.close();

const result = {
  call: "crm_get_account as the EMEA rep",
  machine: { platform: `${platform()} ${release()}`, cpu: cpus()[0]?.model ?? "unknown", cores: cpus().length, memoryGb: Math.round(totalmem() / 2 ** 30), node: process.version },
  warmup: WARMUP, callsPerRun: CALLS, runs: RUNS,
  aggregate: {
    directMedianMs: round(pct(all.direct, 50)), gatewayMedianMs: round(pct(all.gateway, 50)),
    directP95Ms: round(pct(all.direct, 95)), gatewayP95Ms: round(pct(all.gateway, 95)),
    addedMedianMs: round(pct(all.gateway, 50) - pct(all.direct, 50)), addedP95Ms: round(pct(all.gateway, 95) - pct(all.direct, 95)),
  },
  perRun,
};
writeFileSync(new URL("../results/latency.json", import.meta.url), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
