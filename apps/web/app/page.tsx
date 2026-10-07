"use client";

// Paced replay of the measured session. Every number on screen comes from
// public/replay.json, which `pnpm measure` writes from results/run-*.jsonl.
import { useEffect, useMemo, useState } from "react";

type TargetKey = "service" | "user" | "gateway";

interface Cell {
  ok: boolean;
  decision: string;
  error: string | null;
  items: number;
  beyondUser: number;
  writtenWider: number;
  unsignedWrites: number;
  signedWrites: number;
  skippedSignoff: number;
  routineWrites: number;
  returned: number;
  approval: string | null;
}

interface Step {
  id: string;
  persona: string;
  say: string;
  tool: string;
  label: string;
  cells: Record<TargetKey, Cell>;
}

interface Replay {
  seed: number;
  personas: Record<string, { bundle: string; label: string }>;
  tokens: Record<TargetKey, Record<string, number>>;
  toolCounts: Record<TargetKey, Record<string, number>>;
  steps: Step[];
}

const STEP_MS = 1100;
const END_HOLD_MS = 5000;

function totals(steps: Step[], k: TargetKey) {
  return steps.reduce(
    (t, s) => ({
      items: t.items + s.cells[k].items,
      beyondUser: t.beyondUser + s.cells[k].beyondUser,
      wider: t.wider + s.cells[k].writtenWider,
      skipped: t.skipped + s.cells[k].skippedSignoff,
      held: t.held + (s.cells[k].decision === "held" ? 1 : 0),
    }),
    { items: 0, beyondUser: 0, wider: 0, skipped: 0, held: 0 },
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function outcome(c: Cell, k: TargetKey, bundle: string, tool: string): { text: string; tone: "bad" | "warn" | "good" | "muted" } {
  const got = tool === "crm_pipeline_summary" ? plural(c.returned, "stage total", "stage totals") : plural(c.returned, "record", "records");
  if (c.decision === "held") {
    return { text: c.approval === "executed" ? "held, then approved by the EMEA lead" : `held (${c.approval ?? "pending"})`, tone: "good" };
  }
  if (!c.ok) {
    if (c.error?.includes("not in the")) return { text: "blocked: tool not in the team's bundle", tone: "muted" };
    if (c.error?.startsWith("permission denied")) return { text: `denied by the source system${k === "gateway" ? " (dry run)" : ""}`, tone: "muted" };
    if (c.error?.startsWith("not found")) {
      // With the region pinned, "not found" means outside the team's region; otherwise the source hid it from this user.
      if (k === "gateway" && c.decision === "clamped") return { text: "not found in the team's region", tone: "muted" };
      return { text: `denied by the source system: not visible to this user${k === "gateway" ? " (dry run)" : ""}`, tone: "muted" };
    }
    return { text: "error", tone: "muted" };
  }
  if (c.unsignedWrites > 0) {
    if (c.writtenWider > 0) return { text: `wrote ${c.writtenWider} discount floors into a ticket support reads`, tone: "bad" };
    if (c.routineWrites > 0) return { text: `routine write: the ${bundle} bundle needs no sign-off for it`, tone: "muted" };
    return { text: "write ran, nobody signed off", tone: "warn" };
  }
  if (c.items > 0) return { text: `${got}, ${plural(c.items, "item", "items")} outside the team's scope`, tone: "bad" };
  if (c.decision === "clamped") return { text: `${got}, pinned to the team's scope`, tone: "good" };
  return { text: `${got}, all in scope`, tone: "good" };
}

const TONE: Record<string, string> = {
  bad: "text-red-700",
  warn: "text-amber-700",
  good: "text-emerald-700",
  muted: "text-stone-500",
};

function Counter({ label, value, bad, suffix, warn }: { label: string; value: number | string; bad: boolean; suffix?: string; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-stone-200 py-1.5 last:border-0">
      <span className="text-[13px] leading-tight text-stone-600">{label}</span>
      <span className={`font-mono text-2xl font-semibold tabular-nums ${bad ? (warn ? "text-amber-700" : "text-red-700") : "text-emerald-700"}`}>
        {value}
        {suffix ? <span className="ml-1 text-sm font-normal text-stone-500">{suffix}</span> : null}
      </span>
    </div>
  );
}

function Column({ k, title, subtitle, replay, shown, persona }: {
  k: TargetKey; title: string; subtitle: string; replay: Replay; shown: Step[]; persona: string;
}) {
  const t = totals(shown, k);
  const recent = shown.slice(-7).reverse();
  return (
    <section className="flex min-w-0 flex-col rounded-lg border border-stone-300 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mb-3 text-[13px] text-stone-500">{subtitle}</p>
      <Counter label="Items outside the team's scope" value={t.items} bad={t.items > 0} />
      <Counter label="Restricted values written where support can read them" value={t.wider} bad={t.wider > 0} />
      <Counter
        label={`Tool schemas in the agent's context (${replay.toolCounts[k][persona]} tools)`}
        value={replay.tokens[k][persona]!.toLocaleString("en-US")}
        suffix="tokens"
        bad={replay.toolCounts[k][persona]! > 20}
      />
      <Counter label="Writes that skipped a required sign-off" value={t.skipped} bad={t.skipped > 0} warn />
      <ol className="mt-3 space-y-1.5 font-mono text-[12px] leading-snug">
        {recent.map((s, i) => {
          const o = outcome(s.cells[k], k, replay.personas[s.persona]!.bundle, s.tool);
          return (
            <li key={s.id} className={i === 0 ? "" : "opacity-60"}>
              <span className="text-stone-500">{s.tool}</span>
              <br />
              <span className={TONE[o.tone]}>{o.text}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Muted({ replay, shown, persona }: { replay: Replay; shown: Step[]; persona: string }) {
  const t = totals(shown, "service");
  return (
    <section className="flex flex-col rounded-lg border border-stone-200 bg-stone-100 p-3 text-stone-500">
      <h2 className="text-sm font-semibold">Shared service account</h2>
      <p className="mb-3 text-[12px]">one credential that sees everything</p>
      <dl className="space-y-2 text-[12px]">
        <div><dt>outside the team's scope</dt><dd className="font-mono text-xl text-stone-700">{t.items}</dd></div>
        <div><dt>beyond what the user could see at all</dt><dd className="font-mono text-xl text-stone-700">{t.beyondUser}</dd></div>
        <div><dt>restricted values written wider</dt><dd className="font-mono text-xl text-stone-700">{t.wider}</dd></div>
        <div><dt>tool-schema tokens</dt><dd className="font-mono text-xl text-stone-700">{replay.tokens.service[persona]!.toLocaleString("en-US")}</dd></div>
        <div><dt>writes that skipped a required sign-off</dt><dd className="font-mono text-xl text-stone-700">{t.skipped}</dd></div>
      </dl>
    </section>
  );
}

export default function Page() {
  const [replay, setReplay] = useState<Replay | null>(null);
  const [step, setStep] = useState(0);
  const frozen = useMemo(() => {
    if (typeof window === "undefined") return null;
    const v = new URLSearchParams(window.location.search).get("step");
    return v === null ? null : Number(v);
  }, []);

  useEffect(() => {
    void fetch("replay.json").then((r) => r.json()).then((d: Replay) => setReplay(d));
  }, []);

  useEffect(() => {
    if (!replay) return;
    if (frozen !== null) {
      setStep(Math.min(frozen, replay.steps.length));
      return;
    }
    const done = step >= replay.steps.length;
    const id = setTimeout(() => setStep(done ? 0 : step + 1), done ? END_HOLD_MS : STEP_MS);
    return () => clearTimeout(id);
  }, [replay, step, frozen]);

  if (!replay) return <main className="p-8 text-stone-500">Loading the measured run…</main>;
  const shown = replay.steps.slice(0, step);
  const current = shown[shown.length - 1];
  const persona = current?.persona ?? "rep";

  return (
    <main className="mx-auto flex min-h-screen max-w-[1280px] flex-col gap-3 p-5" data-step={step}>
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">One scripted agent session, replayed three ways</h1>
        <p className="font-mono text-sm text-stone-500">
          step {step} / {replay.steps.length} · paced replay · fake systems and data
        </p>
      </header>
      <div className="min-h-[64px] rounded-lg border border-stone-300 bg-white px-4 py-2.5">
        {current ? (
          <>
            <p className="text-[12px] font-semibold uppercase tracking-wide text-stone-500">{replay.personas[current.persona]!.label}</p>
            <p className="text-[15px]">
              “{current.say}” <span className="ml-2 font-mono text-[12px] text-stone-500">{current.tool}</span>
              {current.label === "out-of-policy" ? <span className="ml-2 rounded bg-stone-200 px-1.5 py-0.5 text-[11px] text-stone-600">not the team's job</span> : null}
            </p>
          </>
        ) : (
          <p className="pt-2 text-stone-500">Three personas, {replay.steps.length} tool calls, the same calls against each setup.</p>
        )}
      </div>
      <div className="grid flex-1 grid-cols-[minmax(0,0.8fr)_minmax(0,2fr)_minmax(0,2fr)] gap-3">
        <Muted replay={replay} shown={shown} persona={persona} />
        <Column k="user" title="Own token" subtitle="Sees what the user sees, does what the user can do." replay={replay} shown={shown} persona={persona} />
        <Column k="gateway" title="Through the gateway" subtitle="The team's scope, a smaller tool list, writes held for sign-off." replay={replay} shown={shown} persona={persona} />
      </div>
    </main>
  );
}
