// Renders results/numbers.md and the generated parts of README.md from measured results.
// The README keeps hand-written prose; only the text between the markers is generated.

interface TargetNumbers {
  itemsOutsideScope: number;
  exposure: { rows: number; fields: number; aggregateInputs: number; beyondUser: number; viaToolsOutsideBundle: number };
  restrictedValuesWrittenWider: number;
  writesWithoutSignoff: number;
  writesTotal: number;
  legitimate: { total: number; served: number; notServed: { step: string; reason: string }[] };
  decisions: Record<string, number>;
  toolTokens: Record<string, number>;
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
  steps: { cells: Record<string, { decision: string; signedWrites: number; unsignedWrites: number }> }[];
}

const LABELS: Record<string, string> = {
  service: "Shared service account",
  user: "Per-user token",
  gateway: "**Through the gateway**",
};

export function resultsTable(d: Deterministic): string {
  const rows = ["service", "user", "gateway"].map((k) => {
    const t = d.targets[k]!;
    return `| ${LABELS[k]} | ${t.itemsOutsideScope} | ${t.exposure.beyondUser} | ${t.restrictedValuesWrittenWider} | ${t.writesWithoutSignoff} of ${t.writesTotal} | ${t.toolTokens.rep} | ${t.legitimate.served} of ${t.legitimate.total} |`;
  });
  return [
    "| Agent connects through | Items outside the team's scope | of which beyond the user's own permissions | Restricted values written where more people can read them | Writes without sign-off | Tool-schema tokens in the EMEA agent's context | Legitimate tasks fully served |",
    "|---|---|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}

export function caption(d: Deterministic, replay: Replay): string {
  const s = d.targets.service!;
  const u = d.targets.user!;
  const g = d.targets.gateway!;
  const held = replay.steps.filter((x) => x.cells.gateway!.decision === "held").length;
  const heldApproved = replay.steps.filter((x) => x.cells.gateway!.decision === "held" && x.cells.gateway!.signedWrites > 0).length;
  return [
    `*Paced replay of one scripted session (${d.steps} tool calls, no LLM; the systems and data are fake). `,
    `Middle: the agent uses each person's own token. ${u.itemsOutsideScope} items outside the EMEA team's scope reach it, `,
    `${u.restrictedValuesWrittenWider} discount floors end up in a ticket comment that support can read, and ${u.writesWithoutSignoff} writes run with no sign-off. `,
    `Right: the same calls through the gateway. ${g.itemsOutsideScope} items outside the scope, ${g.restrictedValuesWrittenWider} restricted values written, `,
    `${held} writes held and ${heldApproved} of them approved by the EMEA lead; the ${g.writesWithoutSignoff} unsigned writes are the support team's own `,
    `comment and status change, which its policy allows. Left, muted: a shared service account, ${s.itemsOutsideScope} items, `,
    `${s.exposure.beyondUser} of them beyond what the user could see at all.*`,
  ].join("");
}

function replaceBetween(text: string, name: string, body: string): string {
  const re = new RegExp(`(<!-- ${name}:start -->)[\\s\\S]*?(<!-- ${name}:end -->)`);
  if (!re.test(text)) return text;
  return text.replace(re, `$1\n${body}\n$2`);
}

export function renderReadme(readme: string, d: Deterministic, replay: Replay): string {
  let out = replaceBetween(readme, "results", resultsTable(d));
  out = replaceBetween(out, "caption", caption(d, replay));
  return out;
}

export function renderNumbers(d: Deterministic): string {
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
    rows.push(line(`${t.legitimate.served} of ${t.legitimate.total}`, `Legitimate tasks fully served, ${who}`, raw));
    for (const [persona, n] of Object.entries(t.toolTokens)) {
      rows.push(line(n, `Tool-schema tokens (js-tiktoken cl100k, a proxy) in the ${persona} persona's context, ${who}`, "`results/summary.json`"));
    }
  }
  for (const r of d.observe.rollout) {
    rows.push(line(r.n, `Observe mode, ${r.bundle}: ${r.decision} (${r.reason})`, "`results/run-observe.jsonl`, `results/summary.json`"));
  }
  return [
    "# Numbers",
    "",
    "Every number that appears in the README, and where it comes from. All of them are produced by one command on",
    `seed ${d.seed} and are deterministic: the same command gives the same numbers, which CI checks with \`pnpm measure --check\`.`,
    `The session has ${d.steps} tool calls; the mock systems expose ${d.catalogTools} tools in total.`,
    "",
    "| Number | What it measures | Single run or aggregate | Runs / seeds | Produced by | Raw output |",
    "|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}
