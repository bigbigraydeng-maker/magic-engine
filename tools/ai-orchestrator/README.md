# ME2 AI Orchestrator — v0.1 scaffold

Control plane that lets a GPT reviewer and a Claude implementer take turns around a
GitHub Issue, under hard limits, and stop for a human at every risk gate.

**It is inactive.** No schedule, no automatic trigger, no model call, no repository
write, no cost. Turning it on is a separate, separately-authorized change — see the
Enable checklist in [`docs/specs/2026-08-07-ai-orchestrator-v0.1.md`](../../docs/specs/2026-08-07-ai-orchestrator-v0.1.md) §9.

This is engineering tooling, not Magic Engine product runtime. It imports nothing
from `src/`, touches no database, and sees no customer data.

## Run it

```bash
npx vitest run tools/ai-orchestrator
```

460 tests, all against mock providers. No network, no credentials, no spend.
The dry-run test prints a preflight report showing every guard it evaluated and
what it *would* do next.

No new dependencies: this reuses the repository's `zod` and `vitest`. There is no
`package.json` here on purpose — `tests/architecture.test.ts` fails the build if
one appears, or if anything imports a package the repository does not already
have.

Type check this module on its own — the repository baseline carries 188
pre-existing errors, so only a scoped check can be a gate:

```bash
npx tsc -p tools/ai-orchestrator/tsconfig.json
```

**CI**: `.github/workflows/ai-orchestrator-ci.yml` runs both of the above on
**every** pull request. Ordinary read-only CI — `pull_request` only,
`contents: read`, references no secret, calls no model, writes nothing. The check
name is **`ai-orchestrator-tests`**; that is the string to require in the
`Protect main` ruleset.

It carries no `paths:` filter on purpose. GitHub does not run a workflow on a PR
its filter excludes, so a filtered workflow used as a required check never
reports — it sits Pending and blocks a PR that never touched this module. The job
is read-only and takes about a minute, which is far cheaper than a repository-wide
merge deadlock. The supply-chain suite fails the build if any event filter
reappears.

It is not an orchestrator trigger: the orchestrator itself is still
`workflow_dispatch`-only and still disabled by default.

## Layout

```
src/domain/       schema (zod) · state machine · fold · budget · lease · digest · errors
src/policy/       limits · kill switch · scope + tool enforcement · protected paths · untrusted input
src/prompts/      versioned reviewer and implementer system policies
src/adapters/     github · openai · claude · workspace (git · GitHub PR) · pricing
src/config/       the concrete scaffold configuration
src/runner.ts     preflight and the loop        src/turn-executor.ts  one turn, end to end
src/runner-types.ts  shared types               src/runner-context.ts ledger writes and transitions
tests/            460 tests
```

## The five things worth knowing

**The model does not describe its own turn into compliance.** `files_changed`
comes from `git diff` plus `git status` (an uncommitted change is still a change),
or from GitHub's PR file list. `tools_used` comes from the execution log.
Commit and PR identity come from the adapters. What the model reports is compared
against that record; a mismatch parks the run rather than passing.

**A turn is judged on its delta, not on the whole branch.** The inspector captures
a state before and after each call and diffs the pair by content fingerprint.
Round 1's files are not round 2's work, and "the repository has a HEAD" is not
evidence that this turn committed anything. The cumulative view is kept too, for
the question it actually answers: has the branch as a whole strayed out of scope.


**One round is one agent turn**, not a GPT+Claude pair. It keeps `max_rounds`
unambiguous and means IMPLEMENT mode (which starts with Claude) needs no special
case.

**Run state is a fold over the ledger**, never a second stored copy. A
re-dispatched workflow reads the same Issue comments, lands on the same state, and
does not repeat work. A turn event carries the state it moved the run to, so a
crash cannot land between "the turn happened" and "the run moved on".

**`WAITING_HUMAN` never resumes on its own, and one approval opens one door.**
Every arrival at WAITING_HUMAN opens a wait with a unique id; an authorization
must name that id, be written after it, come from an allowlisted login, be
unexpired, and grant the specific reason the run is blocked on. Leaving records
the wait it consumed, so the same approval cannot clear the next block — which is
what it used to do, silently, several rounds later.

**Exclusion is GitHub's, not the ledger's.** Appending an Issue comment is not a
compare-and-set: two runners reading an idle ledger both conclude they hold the
lease and both pay for a call. The real exclusion is GitHub Actions
`concurrency`, enforced before either process starts, so the runner demands proof
that it covers this Issue and refuses to spend anything without it. The ledger
lease is an audit trail and a stale-holder recovery, and carries a fencing token
so a late release cannot free somebody else's lease.

**Money is committed before the call, at a price the provider quotes.** The
adapter computes the worst case from its own price table — estimated input tokens,
the full output ceiling, cache and tool surcharges, a named `pricing_version` —
and the runner reserves exactly that. No quote, no call: a missing, stale or
oversized input is refused rather than guessed at. A reservation whose runner
vanished is never released, because we cannot know the provider did not bill us.

**A timeout is only a wall if the call really stops.** The runner aborts an
`AbortController` the adapter must honour. An adapter that cannot prove it
cancels declares so, and the lease is then sized to the provider's server-side
maximum instead of to our own timeout. Both real adapters currently declare
`supported: false` — killing our `await` does not kill a child process.

## What stops a run

| Guard | Default | Lands on |
|---|---|---|
| kill switch (label · env var · workflow input) | off | `CANCELLED` |
| max rounds | 6 | `BUDGET_EXHAUSTED` |
| cost cap (remaining must cover the quoted worst case) | $2.00 | `BUDGET_EXHAUSTED` |
| no usable price quote (missing / stale / input too large) | — | `WAITING_HUMAN`, zero calls |
| actual cost above the reservation | — | `WAITING_HUMAN` (the price model is wrong) |
| wall clock | 20 min | `BUDGET_EXHAUSTED` |
| provider call timeout | 8 min | aborted; `provider_timeout`, reservation settled in full |
| lease TTL shorter than the in-flight window + margin | — | refuses to start at all |
| schema-invalid provider output | 2 strikes | `FAILED` |
| out-of-scope path, denied path, unlisted tool (from the record) | — | `WAITING_HUMAN` |
| self-report does not match the record | — | `WAITING_HUMAN` |
| no usable execution telemetry | — | `WAITING_HUMAN` |
| control-plane file touched or drifted | — | `WAITING_HUMAN` |
| no verified exclusive-run context | — | `WAITING_HUMAN`, zero calls |
| the tracked remote ref moved (a push) | — | `WAITING_HUMAN` |
| the remote could not be read | — | `WAITING_HUMAN` (fail closed) |
| any paginated read that cannot be completed | — | throws; no partial ledger, files or labels |
| authorization expired | 6 h | `WAITING_HUMAN` |

Every one of these is checked *before* anything is spent or written.

## Self-protection

An agent running under this orchestrator cannot change the files that govern it.
The protected surface is `.github/**`, `CODEOWNERS` and **all** of
`tools/ai-orchestrator/**` — not a hand-picked subset, because `runner.ts`,
`schema.ts`, the ledger and the adapters can each defeat the guards just as
thoroughly as `policy.ts` can.

The intended consequence: **this tool cannot upgrade itself.**
`workPackageScopeSchema` refuses to parse an authorization whose allowed paths
overlap that surface, so a self-modifying work package cannot be built at all.

Five layers, strongest first:

1. `GITHUB_TOKEN` has no `workflows:` permission, so GitHub itself rejects any push
   touching `.github/workflows/**`. This holds on the Free plan.
2. Only `workflow_dispatch`, which requires repository write access — the agent
   cannot wake itself up.
3. `workPackageScopeSchema` rejects an authorization that grants the surface.
4. `PROTECTED_PATHS` rejects a turn whose **real** changed-file list touches it.
5. `GitControlPlaneIntegrityChecker` asks git whether the surface moved, after
   every turn. This catches the case layer 4 cannot: a change nobody declared.

Branch protection is layer 6 and is now live: no bypass, PRs required, force
push and deletion blocked, unresolved conversations block merge. Required
approvals stay at 0 for now on purpose — the PRs are authored by the repository
owner, and GitHub does not let anyone approve their own PR, so requiring one
would deadlock the flow. That tightens once an independent bot identity authors
the PRs (see E3 below).

## What is deliberately NOT here

This module is an inert scaffold. Four things stand between it and a working
orchestrator, each large enough to need its own design, review and dry run.
They are written up in
[the spec](../../docs/specs/2026-08-07-ai-orchestrator-v0.1.md) §9b:

**E1 — the agent must not write to the repository before policy runs.** Pushing
is already withdrawn (`can_push` is `z.literal(false)` and the push tools are
denied), but the work package still grants `git commit` and `gh pr create`. Catching an
overreach in the diff afterwards is catching a fait accompli. The Enable design
has Claude edit and test in an isolated worktree with no git write tools, and a
deterministic publisher commit, push and open the draft PR only after the checks
pass. AI decides; software writes.

**E2 — the cost ceiling is not proven for real models.** Three characters per
token is not a safe upper bound for Chinese or arbitrary Unicode, and Magic
Engine's context is full of both — that is an *under*-estimate, the wrong
direction. The constant is named `CHARS_PER_TOKEN_OPTIMISTIC` and labelled in
`pricing.ts` rather than quietly replaced, so the gap stays visible. Needs a real tokenizer or a UTF-8 byte-length bound, runtime schema
validation of the price table, a check that the priced model is the model the
adapter actually calls, and a quote that covers a whole multi-turn Claude Code
session rather than one prompt and one completion.

**E3 — `github-actions[bot]` is not an identity.** Every workflow in the
repository with `issues: write` posts as that same login, so trusting a marker by
login proves nothing about which workflow wrote it. Needs a dedicated App or bot
identity, or a signature over the marker using a secret only the orchestrator
holds — plus a decision about what happens when a comment is edited or deleted,
because the ledger currently assumes Issue comments are append-only and on GitHub
they are not.

**E4 — a GitHub Action is not a function.** `claude-code-action` is a workflow
step; the current adapter shape (`implement(request): Promise<Result>`) cannot
call it. Needs an ADR choosing between a three-phase static workflow
(preflight → pinned Action → postflight) and the Claude Code SDK/headless/CLI as
a process the adapter can really start and kill — and a dry run proving telemetry,
cancellation, usage, tool allowlist and output schema are all reachable on the
real path.
