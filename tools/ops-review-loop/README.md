# ME2-OPS02 — Claude ↔ Codex review loop

Removes the manual "Claude pushes → PM types `@codex review` → PM copies findings
back to Claude → repeat" cycle for `claude/*` PRs against `main`. OPS-only:
touches no ME2 runtime, Kernel, migration, product doc, or client file. It never
merges, deploys, applies a migration, queries or writes production data, bypasses
required CI, or marks a PR ready for review — the Product Owner stays the only
merge authority.

The auto-fix leg (step 4 below) originally stayed pinned to a narrow
`claude/me2-*` pilot lane, separate from this leg's `claude/*` scope, so an
unattended push could never land on a branch a live window was holding
(CLAUDE.md §6, one window per branch). It validated end-to-end on that lane
(PR #1174: Codex flagged a seeded bug P2, the dispatch fired, Claude pushed a
correct fix) before widening to match. The collision risk that scoping used to
prevent is now handled at dispatch time instead — see the staleness check
in step 4.

## State diagram (plain language)

1. Claude pushes a commit to a `claude/*` branch, PR targets `main`, same repo (not a fork).
2. **`ops-codex-request-review.yml`** fires on that push. If this exact head sha
   has not already been asked, it posts one PR comment: `@codex review`.
3. The native Codex GitHub App (`chatgpt-codex-connector`) reviews and submits a
   GitHub PR review.
4. **`ops-codex-to-claude-fix.yml`** fires on that review, but only if the
   reviewer login is the Codex connector, the PR is same-repo/`main`/`claude/*`/open,
   and this head sha has not already been handled for the stage about to run.
   It aggregates every review comment (and the review summary) that contains a
   `P0`/`P1`/`P2` tag:
   - **Findings exist, ≤ 3 fix rounds used so far** → posts a "round N of 3"
     marker, then calls `anthropics/claude-code-action` directly with the
     aggregated findings as its prompt. Claude fixes and pushes to the same
     branch — which starts this loop over from step 2 for the new head sha.
   - **Findings exist, a 4th round would be needed** → posts `NEEDS HUMAN REVIEW`
     and stops. No further automation runs on this PR.
   - **No actionable findings, required CI not green yet** → does nothing (no
     comment), so as not to claim readiness prematurely.
   - **No actionable findings, required CI green** → posts
     `READY FOR PRODUCT OWNER`. Still never merges.
   - **Findings exist, but the PR's head has moved past the sha Codex reviewed**
     (someone pushed while the review was in flight) → skips silently. The
     newer push already triggers its own `@codex review` at step 2, which
     re-enters this same decision later against the current head.

Nothing here resolves a review conversation. Nothing here can push to
`.github/workflows/**` or `tools/ai-orchestrator/**` (the fix prompt explicitly
forbids it, on top of whatever the Claude GitHub App's own token permits).

## Risk rating and delivery scoring — wired (ME2-OPS03 PR2)

`risk.mjs`, `sampling.mjs`, `quality.mjs` and `gate-marker.mjs` shipped in
ME2-OPS03 PR1 as pure, offline-tested modules with no workflow calling them.
This PR (PR2) is the wiring:

- `request-review.mjs` (the push leg) rates every PR from its actual changed
  files, posts the rating once per base+head pair, then decides — via
  `sampling.mjs` — whether this head still needs a Codex review before asking
  for one.
- `handle-review.mjs` (the review leg) reads the current trusted rating to
  size the automated-fix round budget (`maxRoundsForRisk`: A=2, B=1, C=1,
  replacing the flat three) and, once Codex has no actionable findings and
  required CI is green, runs the full delivery-quality evaluation
  (`quality.mjs`'s `scoreDelivery` + `evaluateSpecializedEvidence` +
  `decideReadiness`) instead of posting READY unconditionally.
- `recheck-readiness.mjs` (a new leg, `ops-dev-gate-recheck.yml`) closes the
  one gap the review leg cannot: a C-level PR the stable sample does not
  select never gets a Codex review, so nothing would otherwise re-evaluate it
  once required CI goes green. It runs on every completed check run and acts
  only for that exact case.
- `evidence.mjs` and `report.mjs` are new pure modules this wiring needed:
  deterministic signal/evidence detection from PR body text and diff shape,
  and the PM-readable comment text paired with each posted marker.

What the modules decide:

| module | question |
|---|---|
| `risk.mjs` | A / B / C, computed from the PR's changed files — **both ends of a rename**, so a protected file cannot be walked out of the set. Protected path → A; a narrow allowlist (docs, styles, images, test-only) → C; anything unrecognised → B; anything unreadable → A. The PR author's declared level is a floor, never a ceiling. Also reports the **risk categories** hit, which is what decides the evidence owed. |
| `sampling.mjs` | Which C-level heads still draw a Codex review. Stable 20% keyed on `(pr, head sha)` — a re-run cannot re-roll it. A and B are always reviewed. |
| `maxRoundsForRisk` | Automated fix rounds: C=1, B=1, A=2, replacing the flat 3. An unrecognised level gets the smallest budget, not the largest. |
| `quality.mjs` | Score out of 100 from *named observed signals only* (missing evidence scores 0; an unregistered signal throws). Thresholds C≥75 / B≥85 / A≥90. Hard gates — red CI, an open Codex P0/P1/P2 on the current head, a stale sha, **specialised evidence matching the categories hit**, any unreadable input — block readiness at any score. |
| `gate-marker.mjs` | The `<!-- me-dev-gate:{...} -->` record, bound to **both** base and head sha, so a rating dies the moment the diff moves. Only A/B/C are storable, and markers count only when `selectTrustedGateMarkers` says a trusted identity wrote them. |

### Specialised evidence follows the categories, not a fixed list

An earlier draft required one fixed thing of every A-level PR: client-isolation
evidence. Codex's review of PR #1205 pointed out that a migration, a workflow
edit, a payment route and a dependency bump are all A and none of them have an
isolation surface — so they could never be Ready, or their authors would write
isolation prose they had not verified. Manufactured evidence is worse than no
gate. (This very PR is that shape: A because it edits `tools/ops-review-loop/`,
with no isolation surface at all.)

So `classifyRisk` reports categories, `SPECIALIZED_EVIDENCE` says what each one
owes (`db-migration` → migration evidence, `control-plane` → control-plane
evidence, `supply-chain` → dependency justification, and so on), and
`evaluateSpecializedEvidence` compares required against observed. A category the
table does not recognise owes an explicit manual sign-off rather than nothing.

The gate clears **only on a positive, structurally valid claim of
completeness**: `readable === true`, `required` and `missing` both real arrays,
`missing` empty, and `complete === true`. Everything else blocks — not
evaluated, unreadable, malformed, or merely not-positively-complete.

That asymmetry is the whole point, and it was Codex's round-2 finding on
PR #1205. The check used to block only when it could *prove* an item was
missing; an absent or mistyped `missing` field made that condition false, which
is the same answer success gives. Three malformed objects — `{readable: true}`,
`{readable: true, missing: 'not-an-array'}`, and
`{readable: true, missing: [], complete: false}` — therefore took a score-100
A-level PR to READY with zero blockers. An empty missing list is not a claim
that anything was checked.

Two facts worth keeping, because both were measured rather than assumed:

- **Codex does not emit structured quality output.** Real reviews on PR #1204
  (2026-08-27, four reviews across four head shas) are markdown prose with a
  `**Reviewed commit:** \`<sha>\`` line. So `quality.mjs` exports
  `CODEX_QUALITY_FIELDS = 'unavailable'` and takes exactly one fact from Codex —
  the P0/P1/P2 count from `severity.mjs` — as a hard gate, not as a score.
- **The flat 3-round cap is too blunt.** PR #1204 is documentation only and
  still burned all three automated rounds before landing on NEEDS HUMAN REVIEW.
  That PR is why `maxRoundsForRisk` exists.

### `tools/ops-review-loop` tests run in the required check (ME2-OPS03 PR2)

The required check `ai-orchestrator-tests` (`ai-orchestrator-ci.yml`) now runs
`npx vitest run tools/ai-orchestrator tools/ops-review-loop` — both directories,
one required check, no new branch-protection setup needed from the Product
Owner. That also makes `ops-fix-scope-guard.yml`'s bootstrap-branch claim true:
`workflow-guards.test.ts` really is part of a required check now, so deleting
the guard script it asserts on from `main` turns that check red instead of
silently disarming the guard.

## Why plain Node instead of `actions/github-script`

The decision logic (dedup by head-sha + stage marker, the 3-round cap, and the
P0/P1/P2 heuristic) is pure and lives in `src/plan.mjs`, `src/markers.mjs`,
`src/severity.mjs` — each covered by an offline unit test in `tests/`, run with
`npx vitest run tools/ops-review-loop`. Wiring that logic through
`actions/github-script`'s sandboxed script block would put untested glue between
the tests and what actually runs; a plain `node tools/ops-review-loop/src/*.mjs`
step run from a normal `run:` step is the same code the tests exercise. No new
dependency: everything here uses only Node's built-ins (`fetch`, `fs`).

## Control-plane self-protection

Both loop workflows check out `ref: main` explicitly rather than the PR head, so
a PR can never edit the script that decides its own fate (round cap, dedup,
CI gate) — the same principle `tools/ai-orchestrator` uses for its own protected
surface.

## What could not be verified in this session

This PR was built by Claude Code responding to a GitHub Issue, in a sandbox with
**no outbound network access and no `gh` CLI** — `gh auth status` and `WebFetch`
were both denied, and even a local `node` invocation outside the standard
git add/commit/push flow required approval that a non-interactive session cannot
grant. That means:

- The unit tests in `tests/` were written and manually re-derived by hand but
  **not executed** in this session (`node_modules` is not installed here either).
  Run `npx vitest run tools/ops-review-loop` after `npm ci` to confirm.
- **Required-validation items 6/7** are now **ANSWERED — and the answer was no.**
  A bot-authored `@codex review` is *not* treated like a human-authored one.
  Four bot-authored requests (PR #898 2026-08-11 12:38 / 13:58, PR #924
  2026-08-12 01:21 / 02:52) each drew *"To use Codex here, create a Codex
  account and connect to github"*, while the identical text from the Product
  Owner's account on PR #898 at 04:11 drew a real review at 04:15. Codex Cloud
  resolves the request against the **comment author's** Codex account, and
  `github-actions[bot]` has none.

  The blocker was reported rather than worked around (see the note below on why
  `OPS_REVIEW_PAT` is not the "API key / custom GitHub App workaround" the
  original issue forbade), and the resolution the Product Owner chose was to
  author the comment as themselves via a repository-scoped fine-grained PAT.
  The smoke-test workflow now validates *that* path instead.
- The exact bot login for the Codex connector is **confirmed** as
  `chatgpt-codex-connector[bot]`, observed on real `pull_request_review`
  payloads (PR #898 2026-08-11, PR #927 2026-08-12 03:20). The guard still uses
  `contains(login, 'chatgpt-codex-connector')` rather than an exact match, which
  is deliberate: it survives a `[bot]` suffix change. Tighten to an exact match
  only if the Product Owner wants that.
- Whether `.github/workflows/**` pushes from this GitHub App installation are
  actually accepted is untested by this same constraint — see the PR
  description for what happened when this branch was pushed.

### ME2-OPS03 PR2's session had the same constraint

The wiring PR (this one) was built under the identical restriction: no
outbound network access, so `npm ci` could not run, `node_modules` was never
installed, and `npx vitest run tools/ops-review-loop` / `npx tsc --noEmit` /
`npm run build` could not be executed locally. Every new test in `tests/`
(`evidence.test.ts`, `report.test.ts`, `readiness-decision.test.ts`,
`request-review.test.ts`, `recheck-readiness.test.ts`, plus the updates to
`workflow-guards.test.ts` and `gate-marker`/`risk`/`quality`/`sampling`
consumers) was written and hand-traced against the modules it imports, but not
run. The required check (`ai-orchestrator-tests`, now covering this directory
too — see below) is what actually proves it on the frozen head; a human or a
follow-up session with `npm ci` access should confirm before treating this PR
as verified.

## One-time repository setup needed from the Product Owner

- **`OPS_REVIEW_PAT` (required — both loop legs are inert without it).** A
  fine-grained PAT owned by the Product Owner, scoped to **this repository
  only**, with exactly two permissions: **Issues: Read and write** and
  **Pull requests: Read and write**. No contents write, no workflow, no admin.
  Store it as a repository Actions secret named `OPS_REVIEW_PAT`.

  This is not the "API key / custom GitHub App workaround" the original issue
  ruled out. It adds no third-party service and no new bot identity — it makes
  the workflow speak as the human who already has review authority, which is
  the only identity Codex will act on. Without it, `ops-codex-request-review.yml`
  fails closed with an explicit error rather than posting a comment Codex
  silently refuses.
- **`CLAUDE_CODE_OAUTH_TOKEN` must be current.** The return leg
  (`ops-codex-to-claude-fix.yml`) failed 4/4 times on 2026-08-11, each time
  within ~7 seconds at the `claude-code-action` step while the preceding
  decision step succeeded — the signature of an expired token, not a logic bug.
  Regenerate with `claude setup-token` when the loop stops dispatching fixes.
- Run the smoke test (above) once after setting `OPS_REVIEW_PAT` to confirm a
  workflow-posted, PAT-authored `@codex review` draws a real Codex review.
- If `.github/workflows/**` pushes from Claude Code are rejected (see PR
  description), apply the three workflow files in this PR manually, or grant
  the Claude Code GitHub App the `workflows` permission.
