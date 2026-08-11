# ME2-OPS02 — Claude ↔ Codex review loop

Removes the manual "Claude pushes → PM types `@codex review` → PM copies findings
back to Claude → repeat" cycle for `claude/me2-*` PRs against `main`. OPS-only:
touches no ME2 runtime, Kernel, migration, product doc, or client file. It never
merges, deploys, applies a migration, queries or writes production data, bypasses
required CI, or marks a PR ready for review — the Product Owner stays the only
merge authority.

## State diagram (plain language)

1. Claude pushes a commit to a `claude/me2-*` branch, PR targets `main`, same repo (not a fork).
2. **`ops-codex-request-review.yml`** fires on that push. If this exact head sha
   has not already been asked, it posts one PR comment: `@codex review`.
3. The native Codex GitHub App (`chatgpt-codex-connector`) reviews and submits a
   GitHub PR review.
4. **`ops-codex-to-claude-fix.yml`** fires on that review, but only if the
   reviewer login is the Codex connector, the PR is same-repo/`main`/`claude/me2-*`/open,
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

Nothing here resolves a review conversation. Nothing here can push to
`.github/workflows/**` or `tools/ai-orchestrator/**` (the fix prompt explicitly
forbids it, on top of whatever the Claude GitHub App's own token permits).

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
- **Required-validation item 6** (does the native Codex GitHub App accept a
  bot-authored `@codex review` comment at all?) could not be tested live. Run
  the included `OPS — Codex Review Smoke Test` workflow
  (`ops-codex-smoke-test.yml`, `workflow_dispatch`, needs a `pr_number` input)
  against any harmless open PR and watch whether Codex responds. If it does not,
  per the issue's own instruction: stop and report that blocker rather than
  adding an API key, PAT, or custom GitHub App as a workaround.
- The exact bot login for the Codex connector is assumed to be
  `chatgpt-codex-connector[bot]` or close to it (per the issue text); the guard
  uses `contains(login, 'chatgpt-codex-connector')` rather than an exact match so
  a `[bot]` suffix guess can't silently break it, but this should be confirmed
  against a real `pull_request_review` payload once Codex has actually reviewed
  a PR here, and tightened to an exact match if the PM wants that.
- Whether `.github/workflows/**` pushes from this GitHub App installation are
  actually accepted is untested by this same constraint — see the PR
  description for what happened when this branch was pushed.

## One-time repository setup needed from the Product Owner

- Confirm `chatgpt-codex-connector`'s exact bot login (see above) once Codex has
  reviewed a real PR here, and tighten the `contains(...)` guard in
  `ops-codex-to-claude-fix.yml` to an exact match if desired.
- Run the smoke test (above) once to confirm Codex accepts a bot-authored
  `@codex review` comment.
- If `.github/workflows/**` pushes from Claude Code are rejected (see PR
  description), apply the three workflow files in this PR manually, or grant
  the Claude Code GitHub App the `workflows` permission.
