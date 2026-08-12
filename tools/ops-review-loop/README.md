# ME2-OPS02 — Claude ↔ Codex review loop

Removes the manual "Claude pushes → PM types `@codex review` → PM copies findings
back to Claude → repeat" cycle for `claude/*` PRs against `main`. OPS-only:
touches no ME2 runtime, Kernel, migration, product doc, or client file.

## ⚠️ This loop can merge, and merging deploys

**Changed 2026-08-12 by explicit Product Owner decision.** This README said "the
Product Owner stays the only merge authority" until that date. It is no longer
true, and the honest version matters more than the reassuring one:

When Codex returns a **positively clean** review, **every** check run on the head
sha is completed green, the PR is **not a draft**, and GitHub reports it
**mergeable**, this loop merges it with no human in the loop. `main` auto-deploys
to Render, so **an auto-merge is an unreviewed production deploy.** No file type
is excluded — migrations, `render.yaml` and `.github/workflows/**` all qualify.
(Merging a migration *file* still does not apply it: applying remains a separate,
separately-authorised action, per CLAUDE.md.)

**Kill switch — repository variable `OPS_AUTO_MERGE_ENABLED`.** It must equal the
string `true` for any merge to happen. Unset reads as disabled, so the capability
cannot switch itself on. Set it to `false` in the GitHub UI and merging stops
immediately, with no PR and no deploy; the loop falls back to
`READY FOR PRODUCT OWNER` exactly as before.

It is a repository *variable*, not a file and not a secret, for one reason:
workflow files are auto-mergeable now, so a switch stored in one could be
disabled by the very change it exists to stop. Repository variables are outside
anything this loop's token can write.

**Review conversations are now resolved by the loop** (Product Owner decision
2026-08-12) — but only the ones a fix round actually addressed, and only after
that round pushed a real commit. The repository ruleset requires every
conversation resolved before a merge, so without this a PR that took even one
fix round could never auto-merge: the threads Codex opened on the earlier commit
stayed open with nobody left to close them. Resolving asserts "addressed", not
"correct"; Codex's review of the new head is what judges the latter. A round
that pushed nothing resolves nothing.

Still never done here: deploying directly, applying a migration, force-pushing,
querying or writing production data, or marking a draft ready for review.

## State diagram (plain language)

1. Claude pushes a commit to a `claude/*` branch, PR targets `main`, same repo (not a fork).
2. **`ops-codex-request-review.yml`** fires on that push. If this exact head sha
   has not already been asked, it posts one PR comment: `@codex review`.
3. The native Codex GitHub App (`chatgpt-codex-connector`) reviews and submits a
   GitHub PR review.
4. **`ops-codex-to-claude-fix.yml`** fires on that review, but only if the
   reviewer login is the Codex connector, the PR is same-repo/`main`/`claude/me2-*`/open
   (this leg stays narrower than the request leg on purpose — it pushes commits,
   and one window holds a branch at a time),
   and this head sha has not already been handled for the stage about to run.
   It aggregates every review comment (and the review summary) that contains a
   `P0`/`P1`/`P2` tag:
   - **Findings exist, ≤ 3 fix rounds used so far** → posts a "round N of 3"
     marker, then calls `anthropics/claude-code-action` directly with the
     aggregated findings as its prompt. Claude fixes and pushes to the same
     branch — which starts this loop over from step 2 for the new head sha.
   - **Findings exist, a 4th round would be needed** → posts `NEEDS HUMAN REVIEW`
     and stops. No further automation runs on this PR.
   - **No actionable findings, some check not green** → polls for green within
     the run, then posts `BLOCKED ON CI` naming each check that is not green.
     It used to post nothing here, which was indistinguishable from the
     automation being broken.
   - **No actionable findings, every check green, merge gate clear** → **merges
     the PR** at that exact sha (GitHub 409s if the branch moved) and posts
     `AUTO-MERGED`.
   - **No actionable findings, every check green, merge gate blocked** → posts
     `READY FOR PRODUCT OWNER` **listing each blocker by name**. An
     "auto-merge skipped" with no stated reason is how a gate that has quietly
     stopped working looks from the outside, so the reasons are never omitted.

A fix round resolves the review conversations it addressed, and only those, and
only once it has really pushed a commit — see the section above for why.

Nothing here can push to `.github/workflows/**` or `tools/ai-orchestrator/**`
(the fix prompt explicitly forbids it, on top of whatever the Claude GitHub
App's own token permits). ⚠️ That has a consequence worth knowing: when Codex's
findings are in those paths, the fix round runs, changes nothing, and says so —
those need a human.

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

## Verification status

The loop ran end to end for the first time on 2026-08-12:

| Time (UTC) | Event |
|---|---|
| 04:14 | push to a `claude/*` PR → workflow posted `@codex review` **authored by the Product Owner** |
| 04:18 | Codex submitted a real review (2×P1, 1×P2) |
| 04:19 | the review leg dispatched Claude, which ran to completion |

Both legs are therefore proven against the live Codex GitHub App. The tests in
`tests/` are run with `npx vitest run tools/ops-review-loop`.

Historical note — the original build session had no network and no `gh` CLI, so
the items below were open at the time and are kept for provenance:
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
