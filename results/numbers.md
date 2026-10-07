# Numbers

Every number that appears in the README, and where it comes from. All of them are produced by one command on
seed 42 and are deterministic: the same command gives the same numbers, which CI checks with `pnpm measure --check`.
The session has 20 tool calls; the mock systems expose 40 tools in total.

| Number | What it measures | Single run or aggregate | Runs / seeds | Produced by | Raw output |
|---|---|---|---|---|---|
| 304 | Items outside the team agent's scope, shared service account (rows 146, field values 64, aggregate inputs 94) | Single run, deterministic | Seed 42, 1 run per target | `pnpm measure` (`scripts/measure.ts`) | `results/run-service.jsonl`, `results/summary.json` |
| 167 | Of those, beyond the user's own permissions, shared service account | Single run, deterministic | Seed 42, 1 run per target | `pnpm measure` (`scripts/measure.ts`) | `results/run-service.jsonl`, `results/summary.json` |
| 50 | Of those, reached through tools outside the team's bundle, shared service account | Single run, deterministic | Seed 42, 1 run per target | `pnpm measure` (`scripts/measure.ts`) | `results/run-service.jsonl`, `results/summary.json` |
| 6 | Distinct restricted values written where someone who may not see them can read them, shared service account | Single run, deterministic | Seed 42, 1 run per target | `pnpm measure` (`scripts/measure.ts`) | `results/run-service.jsonl`, `results/summary.json` |
| 8 of 8 | Writes that reached a system with no approval id, shared service account | Single run, deterministic | Seed 42, 1 run per target | `pnpm measure` (`scripts/measure.ts`) | `results/run-service.jsonl`, `results/summary.json` |
| 14 of 16 | Legitimate tasks fully served, shared service account | Single run, deterministic | Seed 42, 1 run per target | `pnpm measure` (`scripts/measure.ts`) | `results/run-service.jsonl`, `results/summary.json` |
| 3843 | Tool-schema tokens (js-tiktoken cl100k, a proxy) in the rep persona's context, shared service account | Single run, deterministic | Seed 42, 1 run per target | `pnpm measure` (`scripts/measure.ts`) | `results/summary.json` |
| 3843 | Tool-schema tokens (js-tiktoken cl100k, a proxy) in the manager persona's context, shared service account | Single run, deterministic | Seed 42, 1 run per target | `pnpm measure` (`scripts/measure.ts`) | `results/summary.json` |
| 3843 | Tool-schema tokens (js-tiktoken cl100k, a proxy) in the support persona's context, shared service account | Single run, deterministic | Seed 42, 1 run per target | `pnpm measure` (`scripts/measure.ts`) | `results/summary.json` |
| 137 | Items outside the team agent's scope, per-user token (rows 48, field values 42, aggregate inputs 47) | Single run, deterministic | Seed 42, 1 run per target | `pnpm measure` (`scripts/measure.ts`) | `results/run-user.jsonl`, `results/summary.json` |
| 0 | Of those, beyond the user's own permissions, per-user token | Single run, deterministic | Seed 42, 1 run per target | `pnpm measure` (`scripts/measure.ts`) | `results/run-user.jsonl`, `results/summary.json` |
| 0 | Of those, reached through tools outside the team's bundle, per-user token | Single run, deterministic | Seed 42, 1 run per target | `pnpm measure` (`scripts/measure.ts`) | `results/run-user.jsonl`, `results/summary.json` |
| 6 | Distinct restricted values written where someone who may not see them can read them, per-user token | Single run, deterministic | Seed 42, 1 run per target | `pnpm measure` (`scripts/measure.ts`) | `results/run-user.jsonl`, `results/summary.json` |
| 7 of 7 | Writes that reached a system with no approval id, per-user token | Single run, deterministic | Seed 42, 1 run per target | `pnpm measure` (`scripts/measure.ts`) | `results/run-user.jsonl`, `results/summary.json` |
| 15 of 16 | Legitimate tasks fully served, per-user token | Single run, deterministic | Seed 42, 1 run per target | `pnpm measure` (`scripts/measure.ts`) | `results/run-user.jsonl`, `results/summary.json` |
| 3843 | Tool-schema tokens (js-tiktoken cl100k, a proxy) in the rep persona's context, per-user token | Single run, deterministic | Seed 42, 1 run per target | `pnpm measure` (`scripts/measure.ts`) | `results/summary.json` |
| 3843 | Tool-schema tokens (js-tiktoken cl100k, a proxy) in the manager persona's context, per-user token | Single run, deterministic | Seed 42, 1 run per target | `pnpm measure` (`scripts/measure.ts`) | `results/summary.json` |
| 3843 | Tool-schema tokens (js-tiktoken cl100k, a proxy) in the support persona's context, per-user token | Single run, deterministic | Seed 42, 1 run per target | `pnpm measure` (`scripts/measure.ts`) | `results/summary.json` |
| 0 | Items outside the team agent's scope, gateway (rows 0, field values 0, aggregate inputs 0) | Single run, deterministic | Seed 42, 1 run per target | `pnpm measure` (`scripts/measure.ts`) | `results/run-gateway.jsonl`, `results/summary.json` |
| 0 | Of those, beyond the user's own permissions, gateway | Single run, deterministic | Seed 42, 1 run per target | `pnpm measure` (`scripts/measure.ts`) | `results/run-gateway.jsonl`, `results/summary.json` |
| 0 | Of those, reached through tools outside the team's bundle, gateway | Single run, deterministic | Seed 42, 1 run per target | `pnpm measure` (`scripts/measure.ts`) | `results/run-gateway.jsonl`, `results/summary.json` |
| 0 | Distinct restricted values written where someone who may not see them can read them, gateway | Single run, deterministic | Seed 42, 1 run per target | `pnpm measure` (`scripts/measure.ts`) | `results/run-gateway.jsonl`, `results/summary.json` |
| 2 of 6 | Writes that reached a system with no approval id, gateway | Single run, deterministic | Seed 42, 1 run per target | `pnpm measure` (`scripts/measure.ts`) | `results/run-gateway.jsonl`, `results/summary.json` |
| 16 of 16 | Legitimate tasks fully served, gateway | Single run, deterministic | Seed 42, 1 run per target | `pnpm measure` (`scripts/measure.ts`) | `results/run-gateway.jsonl`, `results/summary.json` |
| 1774 | Tool-schema tokens (js-tiktoken cl100k, a proxy) in the rep persona's context, gateway | Single run, deterministic | Seed 42, 1 run per target | `pnpm measure` (`scripts/measure.ts`) | `results/summary.json` |
| 1774 | Tool-schema tokens (js-tiktoken cl100k, a proxy) in the manager persona's context, gateway | Single run, deterministic | Seed 42, 1 run per target | `pnpm measure` (`scripts/measure.ts`) | `results/summary.json` |
| 974 | Tool-schema tokens (js-tiktoken cl100k, a proxy) in the support persona's context, gateway | Single run, deterministic | Seed 42, 1 run per target | `pnpm measure` (`scripts/measure.ts`) | `results/summary.json` |
| 1 | Observe mode, emea-sales: would-clamp (clamped:limit) | Single run, deterministic | Seed 42, 1 run per target | `pnpm measure` (`scripts/measure.ts`) | `results/run-observe.jsonl`, `results/summary.json` |
| 8 | Observe mode, emea-sales: would-clamp (pinned:region) | Single run, deterministic | Seed 42, 1 run per target | `pnpm measure` (`scripts/measure.ts`) | `results/run-observe.jsonl`, `results/summary.json` |
| 5 | Observe mode, emea-sales: would-clamp (restricted:fields) | Single run, deterministic | Seed 42, 1 run per target | `pnpm measure` (`scripts/measure.ts`) | `results/run-observe.jsonl`, `results/summary.json` |
| 1 | Observe mode, emea-sales: would-deny (not-in-bundle) | Single run, deterministic | Seed 42, 1 run per target | `pnpm measure` (`scripts/measure.ts`) | `results/run-observe.jsonl`, `results/summary.json` |
| 4 | Observe mode, emea-sales: would-hold (approval-required) | Single run, deterministic | Seed 42, 1 run per target | `pnpm measure` (`scripts/measure.ts`) | `results/run-observe.jsonl`, `results/summary.json` |
| 1 | Observe mode, support: would-clamp (restricted:fields) | Single run, deterministic | Seed 42, 1 run per target | `pnpm measure` (`scripts/measure.ts`) | `results/run-observe.jsonl`, `results/summary.json` |
| 1 | Observe mode, support: would-deny (not-in-bundle) | Single run, deterministic | Seed 42, 1 run per target | `pnpm measure` (`scripts/measure.ts`) | `results/run-observe.jsonl`, `results/summary.json` |
| 1 | Observe mode, emea-sales: would-deny (source-denied) | Single run, deterministic | Seed 42, 1 run per target | `pnpm measure` (`scripts/measure.ts`) | `results/run-observe.jsonl`, `results/summary.json` |
