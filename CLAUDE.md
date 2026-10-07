# CLAUDE.md

## What this repo is
A small, real project: an MCP gateway measured against two baselines on a scripted session. The README and the numbers matter as much as the code.

## Commands
- Database: `docker compose up -d` (Postgres 15.13 on port 54329)
- Build: `pnpm install && pnpm typecheck`
- Seed the template database: `pnpm seed`
- Test: `pnpm test`
- Replay the session against one target: `pnpm trace --target service|user|gateway [--observe]`
- Run the systems and gateway locally on fixed ports: `pnpm stack [--observe]`
- Approve or reject a held write on that stack: `pnpm approve <id> --as <person>`, `pnpm reject <id> --as <person>`
- Optional measurements: `pnpm seeds` (seeds 1-5), `pnpm latency` (gateway hop); re-run `pnpm measure` afterwards to refresh `results/numbers.md`
- Run the demo: `pnpm dev`, then open http://localhost:3000 (paced replay of the measured run)
- Record `docs/demo.gif`: `PLAYWRIGHT_BROWSERS_PATH=data/ms-playwright pnpm record` (needs ffmpeg and `npx playwright install chromium`)
- Measure / regenerate results: `pnpm measure` (writes `results/`, `results/numbers.md` and the generated parts of the README); `pnpm measure --check` fails if any deterministic number changed

## How to work
- Tests alongside code. CI must be green before a change counts as done.
- Don't disable, skip or delete a failing test to get CI green. Fix the cause or ask.
- If a dependency download fails, find another way to get it (git clone, vendored tarball) instead of dropping the feature.
- Commit messages: short, plain, imperative ("Add rate controller"), no emoji, no conventional-commit prefixes.
- Small commits, one per step. Don't squash history and never force-push `main`.
- Stay inside this repo, and never run destructive commands (`rm -rf`, `git reset --hard`, force-push) without asking.

## Numbers and honesty
- **Every number in the README comes from a measurement in this repo**, with the script that produced it committed and the raw output in `results/`. Record in `results/numbers.md` whether each number is a single run or an aggregate, and how many runs.
- **No placeholders in anything public:** no "TBD", "to run", empty table rows. Fill it or delete it.
- **Honest limits.** If something is simulated, synthetic or heuristic, the README says so.
- **No fake data presented as real.** Synthetic or sample data is labeled as such in code and README.

## Reproducibility and licenses
- **Reproducible:** seeded randomness, pinned versions and lockfiles committed, so the same command gives the same numbers.
- No telemetry, no secrets in the repo (API keys, tokens, `.env`), MIT license.
- **Dependency licenses:** no AGPL or other copyleft dependencies, and no models or datasets whose license forbids redistribution committed to the repo. Fetch those with scripts and note their licenses in the README.

## README shape (keep this order)
1. The byline under the title ("By Ahmed Sozzer" linking to amsozzer.com, plus the GitHub link). Then one line on what it is, and one short paragraph on the problem.
2. The money shot: GIF or screenshot, with a caption saying what you're looking at.
3. Results table vs the baseline, and where it was measured.
4. How it works (short, with a diagram if it helps).
5. Run it (copy-paste commands that work from a clean clone).
6. Named assumptions and honest limits.
7. What I'd do next.
8. License.

## Writing style for README and docs
Plain and direct. No marketing words (seamless, robust, leverage, cutting-edge), no em dashes, no slogans at the end of paragraphs, no emoji headers.
