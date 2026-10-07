// Renders results/numbers.md and the generated parts of README.md from measured results.
// The README keeps hand-written prose; only the text between the markers is generated.

interface TargetNumbers {
  itemsOutsideScope: number;
  exposure: { rows: number; fields: number; aggregateInputs: number; beyondUser: number; viaToolsOutsideBundle: number };
  restrictedValuesWrittenWider: number;
  writesWithoutSignoff: number;
  writesSkippingRequiredSignoff: number;
  routineUnsignedWrites: number;
  writesHeld: number;
  writesHeldThenApproved: number;
  writesTotal: number;
  legitimate: { total: number; served: number; notServed: { step: string; reason: string }[] };
  decisions: Record<string, number>;
  toolTokens: Record<string, number>;
  toolCounts: Record<string, number>;
}

export interface Deterministic {
  seed: number;
  steps: number;
  catalogTools: number;
  targets: Record<string, TargetNumbers>;
  observe: { rollout: { bundle: string; decision: string; reason: string; n: number }[]; decisions: Record<string, number>; itemsOutsideScope: number };
  gatewayCostOfScoping: { step: string; decision: string; reasons: string[] }[];
}

interface Replay {
  personas: Record<string, { bundle: string }>;
  steps: { persona: string; tool: string; cells: Record<string, { decision: string; signedWrites: number; unsignedWrites: number }> }[];
}

const LABELS: Record<string, string> = {
  service: "Shared service account",
  user: "Per-user token",
  gateway: "**Through the gateway**",
};

export function resultsTable(d: Deterministic): string {
  const rows = ["service", "user", "gateway"].map((k) => {
    const t = d.targets[k]!;
    return `| ${LABELS[k]} | ${t.itemsOutsideScope} | ${t.exposure.beyondUser} | ${t.restrictedValuesWrittenWider} | ${t.writesSkippingRequiredSignoff} of ${t.writesTotal} | ${t.toolTokens.rep} | ${t.legitimate.served} of ${t.legitimate.total} |`;
  });
  const routine = ["service", "user", "gateway"].map((k) => d.targets[k]!.routineUnsignedWrites);
  const note = routine.every((n) => n === routine[0])
    ? `In every column, ${routine[0]} routine support ${routine[0] === 1 ? "write" : "writes"} also ran unsigned, because the support bundle doesn't require sign-off for ${routine[0] === 1 ? "it" : "them"}; they are counted in the totals, not in the column.`
    : `Routine writes that ran unsigned because the policy doesn't require sign-off for them: ${routine.join(", ")} (service account, per-user token, gateway); they are counted in the totals, not in the column.`;
  return [
    "| Agent connects through | Items outside the team's scope | of which beyond the user's own permissions | Restricted values written where more people can read them | Writes that skipped a sign-off the team's policy requires | Tool-schema tokens in the EMEA agent's context | Legitimate tasks fully served |",
    "|---|---|---|---|---|---|---|",
    ...rows,
    "",
    note,
  ].join("\n");
}

export function caption(d: Deterministic, replay: Replay): string {
  const s = d.targets.service!;
  const u = d.targets.user!;
  const g = d.targets.gateway!;
  const held = g.writesHeld;
  const heldApproved = g.writesHeldThenApproved;
  const unsignedBundles = [...new Set(replay.steps.filter((x) => x.cells.gateway!.unsignedWrites > 0).map((x) => replay.personas[x.persona]!.bundle))];
  const unsignedNote = g.routineUnsignedWrites === 0 ? ""
    : `; ${g.routineUnsignedWrites} routine ${g.routineUnsignedWrites === 1 ? "write" : "writes"} from the ${unsignedBundles.join(" and ")} `
      + `${unsignedBundles.length === 1 ? "bundle ran" : "bundles ran"} unsigned, as ${unsignedBundles.length === 1 ? "its" : "their"} policy allows`;
  return [
    `*Paced replay of one scripted session (${d.steps} tool calls, no LLM; the systems and data are fake). `,
    `Middle: the agent uses each person's own token. ${u.itemsOutsideScope} items outside the EMEA team's scope reach it, `,
    `${u.restrictedValuesWrittenWider} discount floors end up in a ticket comment that support can read, and ${u.writesSkippingRequiredSignoff} writes that the team's policy says need sign-off run without it. `,
    `Right: the same calls through the gateway. ${g.itemsOutsideScope} items outside the scope, ${g.restrictedValuesWrittenWider} restricted values written, `,
    `${held} writes held and ${heldApproved} of them approved by the EMEA lead${unsignedNote}. `,
    `Left, muted: a shared service account, ${s.itemsOutsideScope} items, `,
    `${s.exposure.beyondUser} of them beyond what the user could see at all.*`,
  ].join("");
}

function replaceBetween(text: string, name: string, body: string, inline = false): string {
  const re = new RegExp(`(<!-- ${name}:start -->)[\\s\\S]*?(<!-- ${name}:end -->)`);
  if (!re.test(text)) return text;
  return text.replace(re, inline ? `$1${body}$2` : `$1\n${body}\n$2`);
}

export function summaryParagraph(d: Deterministic, opt: Optional): string {
  const g = d.targets.gateway!;
  const parts: string[] = [];
  parts.push(`What the gateway costs: ${d.gatewayCostOfScoping.length} of the ${g.legitimate.total} legitimate calls had something pinned or held `
    + `(region pinned, row limit clamped, fields removed, or a write held for sign-off), and ${g.legitimate.served} of ${g.legitimate.total} still got everything `
    + `the task needed, checked against what the oracle says each task needs.`);
  if (opt.seeds) {
    const xs = (k: string) => opt.seeds!.filter((r) => r.target === k);
    const range = (v: number[]) => (Math.min(...v) === Math.max(...v) ? `${v[0]}` : `${Math.min(...v)} to ${Math.max(...v)}`);
    parts.push(`Seeds 1 to 5 give the same picture: per-user tokens leave ${range(xs("user").map((r) => r.itemsOutsideScope))} items outside the team's scope `
      + `and write ${range(xs("user").map((r) => r.restrictedValuesWrittenWider))} restricted values wider; the gateway leaves `
      + `${range(xs("gateway").map((r) => r.itemsOutsideScope))} and ${range(xs("gateway").map((r) => r.restrictedValuesWrittenWider))}, and serves `
      + `${range(xs("gateway").map((r) => r.legitimateServed))} of ${xs("gateway")[0]!.legitimateTotal} legitimate tasks on every seed.`);
  }
  if (opt.latency) {
    const a = opt.latency.aggregate;
    parts.push(`The gateway hop adds ${a.addedMedianMs} ms at the median and ${a.addedP95Ms} ms at p95 to one read call `
      + `(${a.directMedianMs} ms direct vs ${a.gatewayMedianMs} ms through the gateway; ${opt.latency.runs} runs of ${opt.latency.callsPerRun} calls, one machine, loopback).`);
  }
  return parts.join("\n\n");
}

export function rolloutSentence(d: Deterministic, bundle = "emea-sales"): string {
  const n = (decision: string, reason: string) =>
    d.observe.rollout.filter((r) => r.bundle === bundle && r.decision === decision && r.reason === reason).reduce((s, r) => s + r.n, 0);
  const calls = (x: number) => `${x} ${x === 1 ? "call" : "calls"}`;
  return `for the EMEA sales agent in this session: ${calls(n("would-deny", "not-in-bundle"))} to a tool outside the bundle, `
    + `${calls(n("would-clamp", "pinned:region"))} pinned to EMEA, ${calls(n("would-clamp", "restricted:fields"))} with fields removed, `
    + `${calls(n("would-clamp", "clamped:limit"))} with the row limit clamped, ${calls(n("would-hold", "approval-required"))} that would wait for sign-off, `
    + `and ${calls(n("would-deny", "source-denied"))} the CRM would refuse anyway`;
}

export function renderReadme(readme: string, d: Deterministic, replay: Replay, opt: Optional = {}): string {
  let out = replaceBetween(readme, "results", resultsTable(d));
  out = replaceBetween(out, "caption", caption(d, replay));
  out = replaceBetween(out, "summary", summaryParagraph(d, opt));
  out = replaceBetween(out, "rollout", rolloutSentence(d), true);
  return out;
}

export interface Optional {
  seeds?: { seed: number; target: string; itemsOutsideScope: number; beyondUser: number; restrictedValuesWrittenWider: number; writesWithoutSignoff: number; writesTotal: number; legitimateServed: number; legitimateTotal: number }[];
  latency?: { warmup: number; callsPerRun: number; runs: number; machine: { cpu: string; cores: number; memoryGb: number; platform: string; node: string }; aggregate: Record<string, number> };
}

export function renderNumbers(d: Deterministic, opt: Optional = {}, postgres = "unknown"): string {
  const src = "`pnpm measure` (`scripts/measure.ts`)";
  const line = (n: string | number, what: string, raw: string) =>
    `| ${n} | ${what} | Single run, deterministic | Seed ${d.seed}, 1 run per target | ${src} | ${raw} |`;
  const rows: string[] = [];
  for (const k of ["service", "user", "gateway"]) {
    const t = d.targets[k]!;
    const raw = `\`results/run-${k}.jsonl\`, \`results/summary.json\``;
    const who = { service: "shared service account", user: "per-user token", gateway: "gateway" }[k]!;
    rows.push(line(t.itemsOutsideScope, `Items outside the team agent's scope, ${who} (rows ${t.exposure.rows}, field values ${t.exposure.fields}, aggregate inputs ${t.exposure.aggregateInputs})`, raw));
    rows.push(line(t.exposure.beyondUser, `Of those, beyond the user's own permissions, ${who}`, raw));
    rows.push(line(t.exposure.viaToolsOutsideBundle, `Of those, reached through tools outside the team's bundle, ${who}`, raw));
    rows.push(line(t.restrictedValuesWrittenWider, `Distinct restricted values written where someone who may not see them can read them, ${who}`, raw));
    rows.push(line(`${t.writesWithoutSignoff} of ${t.writesTotal}`, `Writes that reached a system with no approval id, ${who}`, raw));
    rows.push(line(`${t.writesSkippingRequiredSignoff} of ${t.writesTotal}`, `Of those, writes that skipped a sign-off the team's policy requires (the tool needs sign-off, or isn't in the team's bundle at all), ${who}`, raw));
    rows.push(line(t.routineUnsignedWrites, `Of those, routine writes the team's policy allows without sign-off, ${who}`, raw));
    if (k === "gateway") {
      rows.push(line(t.writesHeld, "Writes the gateway held for sign-off", raw));
      rows.push(line(t.writesHeldThenApproved, "Of those, approved by the EMEA lead and run", raw));
      rows.push(line(`${d.gatewayCostOfScoping.length} of ${t.legitimate.total}`, "Legitimate calls that had something pinned or held (region pinned, row limit clamped, fields removed, or a write held)", raw));
    }
    rows.push(line(`${t.legitimate.served} of ${t.legitimate.total}`, `Legitimate tasks fully served, ${who}`, raw));
    for (const [persona, n] of Object.entries(t.toolTokens)) {
      rows.push(line(n, `Tool-schema tokens (js-tiktoken cl100k, a proxy) in the ${persona} persona's context, ${who}`, "`results/summary.json`"));
      rows.push(line(t.toolCounts[persona]!, `Tools listed to the ${persona} persona's agent, ${who}`, "`results/summary.json`"));
    }
  }
  for (const r of d.observe.rollout) {
    rows.push(line(r.n, `Observe mode, ${r.bundle}: ${r.decision} (${r.reason})`, "`results/run-observe.jsonl`, `results/summary.json`"));
  }
  if (opt.seeds) {
    for (const k of ["service", "user", "gateway"]) {
      const xs = opt.seeds.filter((r) => r.target === k);
      const range = (f: (r: (typeof xs)[number]) => number) => {
        const v = xs.map(f);
        return Math.min(...v) === Math.max(...v) ? `${v[0]}` : `${Math.min(...v)} to ${Math.max(...v)}`;
      };
      const raw = "`results/seeds.json`";
      const src2 = "`pnpm seeds` (`scripts/seeds.ts`)";
      const agg = (n: string, what: string) => `| ${n} | ${what} | Range over 5 single runs, each deterministic | Seeds 1-5, 1 run per seed | ${src2} | ${raw} |`;
      rows.push(agg(range((r) => r.itemsOutsideScope), `Items outside the team agent's scope, ${k}, across seeds`));
      rows.push(agg(range((r) => r.restrictedValuesWrittenWider), `Restricted values written wider, ${k}, across seeds`));
      rows.push(agg(range((r) => r.writesWithoutSignoff), `Writes without sign-off, ${k}, across seeds`));
      rows.push(agg(range((r) => r.legitimateServed), `Legitimate tasks fully served (of ${xs[0]!.legitimateTotal}), ${k}, across seeds`));
    }
  }
  if (opt.latency) {
    const l = opt.latency;
    const m = `${l.machine.cpu}, ${l.machine.cores} cores, ${l.machine.memoryGb} GB, ${l.machine.platform}, Node ${l.machine.node}`;
    const lat = (n: number, what: string) =>
      `| ${n} ms | ${what} | Aggregate over all ${l.runs * l.callsPerRun} timed calls | ${l.runs} runs x ${l.callsPerRun} calls after ${l.warmup} warm-up calls, seed ${d.seed}, ${m} | \`pnpm latency\` (\`scripts/latency.ts\`) | \`results/latency.json\` |`;
    rows.push(lat(l.aggregate.directMedianMs!, "Median wall-clock time of one read call, per-user token straight to the CRM"));
    rows.push(lat(l.aggregate.gatewayMedianMs!, "Median wall-clock time of the same call through the gateway (audit insert included)"));
    rows.push(lat(l.aggregate.addedMedianMs!, "Added median latency of the gateway hop (difference of the two medians)"));
    rows.push(lat(l.aggregate.addedP95Ms!, "Added p95 latency of the gateway hop (difference of the two p95s)"));
  }
  return [
    "# Numbers",
    "",
    "Every number that appears in the README, and where it comes from. All of them are produced by one command on",
    `seed ${d.seed}. The counters are deterministic: the same command gives the same numbers, which CI checks with \`pnpm measure --check\`.`,
    "The seed sweep is also deterministic. Latency is wall-clock time, so it is not deterministic and is not part of the CI check.",
    `The session has ${d.steps} tool calls; the mock systems expose ${d.catalogTools} tools in total. Last measured on Postgres ${postgres}.`,
    "",
    "| Number | What it measures | Single run or aggregate | Runs / seeds | Produced by | Raw output |",
    "|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}
