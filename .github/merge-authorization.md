# Merge authorization gate

The workflow in `pr-merge-authorization.yml` turns merge authorization into a
required, exact-revision check instead of relying on an agent remembering a
chat phrase.

One-time repository setup after the workflow reaches `main`:

1. Create the GitHub Environment `merge-authorization`.
2. Add Ray as its sole required reviewer and prevent administrator bypass.
3. In the `main` ruleset, require the status check `Merge authorization (Ray)`.
4. Do not grant automation tokens permission to approve protected environments.

Operating rule:

- Draft PRs need no approval and cannot be merged.
- When a PR becomes ready, its current head waits for environment approval.
- Every new commit cancels the prior run and creates a new approval request, so
  an approval cannot silently carry over to changed code.
- `GO MERGE #<number>` remains the human instruction in Build Control. The
  controller may open the matching environment approval for Ray, but it must
  never infer authorization from “continue”, “candidate”, or “visual pass”.

Exemption (PM decision 2026-09-25):

- A PR whose only changed files live under `docs/ledger/` skips the environment
  approval (`detect-ledger-only` job). The ledger checks in `ledger-check.yml`
  still gate it, and repository auto-merge is enabled so the nightly
  `claude/ledger-verify-*` PRs merge on their own once CI is green.
- Rationale: requiring a human click for every status flip on a ledger card is
  how ROADMAP died. Accepted cost: a human-authored ledger-only PR can edit a
  card's frozen fields without review; the format and pointer checks are the
  only guard.

This gate never merges, deploys, publishes, or contacts a paid provider.
