# Design notes

Why each decision was made, what was tried and dropped, and what the numbers changed.

## 1. Call the source as the user instead of syncing permissions and filtering results
**Chose:** the gateway maps each person to their own token on each system and calls the system with it. The source applies its own permissions. The gateway never removes records from a result after the fact.

**Because:** filtering after the call gets several things wrong.
- **Totals:** a pipeline total computed by a service account already includes deals the user can't see, and removing rows afterwards can't fix the number. In the measured run, the service account's two pipeline summaries drew on 94 out-of-scope rows.
- **Row limits:** ask for 50 rows, drop 45 the user can't see, and the agent gets 5 with no way to know more exist.
- **Cursors and nested records** have the same problem.

**When sync is unavoidable:** sources that only offer a service account, and anything served from an index built ahead of time (search over synced documents). Those need a copy of the source's permissions and a filter, and the copy is stale until the next sync. That is the path I'd build next; it isn't in this repo.

## 2. Give the team's agent less than the user, using parameters the source honours
**Chose:** each team bundle declares a scope (regions, fields), and the gateway pins `region`, `limit` and `fields` on every call so the source returns only that.

**Because:** with per-user tokens, the gateway can't do anything useful on reads unless the agent's scope is narrower than the person's. The measured case is a sales director using the EMEA team's agent. Their own token returns every region and the discount floors. Over the session, per-user tokens let 137 items outside the team's scope reach the agent, 117 of them from the director's three reads. Pinning brings that to 0, and every legitimate task still gets what it needs (16 of 16).

**How it's checked:** pinning only works if every tool honours the parameters. A test calls every read tool in both bundles with `region` and `fields` and checks the source returned only conforming rows and fields, including the pipeline summary, whose `min_discount_floor` must disappear when `discount_floor` isn't allowed.

## 3. Where the user tokens come from
**Chose:** a seeded `gateway.identities` table, one token per person per system.

**In practice** this is admin-authorized impersonation (a JWT bearer grant, domain-wide delegation) or an on-behalf-of token exchange. Either way the gateway holds a credential that can mint a token for any user, so it is a service account with a better audit trail. That credential is the asset to protect. Tokens should be short-lived and scoped down at exchange. A held write can wait longer than a token lives, so the executor needs to refresh or ask for consent again before running it.

## 4. Writes: dry-run, hold, then run once as the requester
**Chose:** a write that matches an approval rule is first dry-run upstream as the user, so writes the user isn't allowed to make are refused before anyone is asked to approve them. Then it is held. Approval is one atomic `update ... where status = 'pending'`. The write runs as the requester, so the source checks permission again at that moment.

The approval id reaches the source in a header that is only honoured with the executor's secret. That is what makes "writes without sign-off" measurable, and it stops an agent from claiming a sign-off it doesn't have; a test sends a forged id and checks it is ignored.

**What went wrong first:** the double-approve test asserted that only one of two concurrent approve calls returned `executed`. It passed locally and failed in CI. The losing call correctly reports the approval's current status, and on a slower machine that status was already `executed`. The write still ran once (the write-log check passed). The fix was to return an explicit `ran` flag and assert that exactly one call ran the write.

**Not done:** approvals don't carry the record's version, so a record that changes between hold and approve gets overwritten. That is in the README's limits.

## 5. Observe mode first
**Chose:** a run-level flag. In observe mode the gateway lists the full catalog, runs the same checks (including the dry-run for writes), records would-deny, would-clamp and would-hold, and passes the original call through.

**Because:** no team turns enforcement on the first day. A week of observe mode gives the team lead a concrete list of what would change, which is what the "Rolling this out" section in the README walks through.

**What it doesn't prove:** in observe mode reads aren't pinned, so later steps that use earlier results can resolve to different records. The observe report shows the same checks firing on real traffic. It is not an exact prediction of what enforce mode returns. An earlier plan reported "observe counts equal enforce counts" as a check; it was dropped because that equality only shows the decision code agrees with itself.

## 6. An oracle that doesn't share code with what it checks
**Chose:** `packages/oracle` re-implements both systems' permission rules in plain TypeScript, over the generator's people (never the gateway's identity table). It reads only the `scope:` block of the policy, never the parameters the gateway pins. A property test checks the SQL and the oracle agree for all 16 generated users on every read tool, paged to the end, with `get` on every id.

**Check of the check:** I broke the SQL's field-level security on purpose (let reps see `discount_floor`). The property test failed for 9 of 16 users, then passed again once the change was reverted.

**What went wrong first:** the first identity-swap test I planned swapped the EMEA rep's CRM identity with the sales director's. It would never have tripped the oracle: with the region pinned to EMEA and the discount floor removed, the director's token returns exactly what the rep's would. The pins hid the swap, which is defense in depth, but it makes a useless test. The test now swaps the support persona's ticket identity with an agent in a project they aren't in, and the oracle counts every returned row as beyond the user's permissions. The swap also showed that the gateway caches upstream connections per user, so an identity change needs a restart; that is in the README's limits.

## 7. One fresh database and in-process servers per run
**Chose:** each target runs against its own copy of the seed template (`create database ... template gatehouse_seed`), with both mock systems and the gateway started in the same Node process on ephemeral ports.

**Tried first:** the plan was separate processes on fixed ports, restarted per target with `DATABASE_URL` pointing at each copy. In-process servers get the same isolation (a fresh database and fresh connection pools per run) without stale processes or port checks. A run refuses to start if the write log isn't empty. Postgres refuses to copy a template while anything is connected to it, so seeding closes its connection and nothing else ever connects to the template.

## 8. Numbers that move from the plan
- **Latency:** the plan guessed "a few ms". The measured hop is 0.3 ms at the median and 0.62 ms at p95, on one machine over loopback with Postgres local. The number is kept as measured; across a real network the network would dominate it.
- **Tool tokens, "only the systems the team uses":** the plan had three token counts per persona. Both teams use both systems, so the middle count equals the full catalog and was dropped. The two counts that remain are 40 tools (3,843 tokens) for every direct connection, against 14 tools (1,774 tokens) for the EMEA bundle and 9 tools (974 tokens) for support.
- **Writes without sign-off through the gateway** came out as 2, not 0. They are the support team's own comment and status change, and its bundle has no approval rule for them. In the first version of the results table, that "2 of 6" was the only non-zero cell in the gateway row, and it read as a failure. The table now counts writes that skipped a sign-off the team's policy requires (6, 5 and 0). The 2 routine writes, which are the same in every column, are stated under the table, and both counts are in `results/numbers.md`.
