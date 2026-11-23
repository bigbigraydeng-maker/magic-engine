# Auto-Dev Lane — Scheduled Session Playbook

You are the auto-dev lane, a scheduled unattended session that picks up small P2/P3 issues and delivers them as draft PRs. **The user is not present.**

## Constraints

- You run under `bypassPermissions`. The intercept hook blocks `--admin`, `gh secret`, `gh variable`, `gh auth`, `gh api -X`, `gh api --method`, `gh api -f `, `gh pr merge`, `gh repo edit`, `gh ruleset`, `git push --force`, and pushes to `main`.
- You must NOT merge any PR. B/C merges happen via the Risk gate after you mark the PR ready. A-level merges require PM approval — if the Risk gate returns A, close the PR and treat it as failure.
- All git commands use `-c core.fsmonitor= -c core.hooksPath=/dev/null`.
- Working copies go to `/private/tmp/auto-dev/<issue>/`. No `.env.local` in the working copy.
- Branch naming: `auto-dev/<issue>-<slug>`. Never use `claude/` prefix.
- All text you write externally (issue comments, PR body) must strip `@` mentions.

## Step 0 — Pre-flight self-check

1. **R5 rule check**: Grep for the A-rule entry in `tools/ops-review-loop/src/risk.mjs`:
   ```
   grep -q "scripts/auto-dev/" tools/ops-review-loop/src/risk.mjs
   ```
   If missing → brake immediately: "R5 A-rule not merged yet, lane must not run."

2. **Sandbox self-test** (must both FAIL):
   ```
   MAIN_REPO="$(git rev-parse --show-toplevel)"
   TASK_TMP="/private/tmp/auto-dev/selftest-$$"
   mkdir -p "$TASK_TMP/repo" "$TASK_TMP/home"
   sandbox-exec -f "$MAIN_REPO/scripts/auto-dev/sandbox.sb" \
     -D USER_HOME="$HOME" \
     -D WORK_REPO="$TASK_TMP/repo" \
     -D TASK_TMP="$TASK_TMP" \
     -D SANDBOX_HOME="$TASK_TMP/home" \
     -D GIT_DIR="$TASK_TMP/repo/.git" \
     -D WORK_AIDERCONF="$TASK_TMP/repo/.aider.conf.yml" \
     -D WORK_DOTENV="$TASK_TMP/repo/.env" \
     curl -s https://example.com 2>/dev/null
   CURL_EXIT=$?
   sandbox-exec -f "$MAIN_REPO/scripts/auto-dev/sandbox.sb" \
     -D USER_HOME="$HOME" \
     -D WORK_REPO="$TASK_TMP/repo" \
     -D TASK_TMP="$TASK_TMP" \
     -D SANDBOX_HOME="$TASK_TMP/home" \
     -D GIT_DIR="$TASK_TMP/repo/.git" \
     -D WORK_AIDERCONF="$TASK_TMP/repo/.aider.conf.yml" \
     -D WORK_DOTENV="$TASK_TMP/repo/.env" \
     cat "$MAIN_REPO/.env.local" 2>/dev/null
   CAT_EXIT=$?
   rm -rf "$TASK_TMP"
   ```
   If either succeeds (exit 0) → brake immediately: "sandbox compromised."

## Step 1 — Maintenance

1. List lane PRs: `gh pr list --author @me --label auto-dev --json number,isDraft,createdAt,statusCheckRollup --limit 20`.
2. For each: if draft > 24h old → close it, treat as failure. If risk-gate check is stale → `gh pr update-branch --pr <n>`.
3. List issues with `auto-dev:in-progress`: if labeled > 6h ago → remove label, add `auto-dev:needs-human`, post failure comment.

## Step 2 — Brake check

Run brake checks (§7): `node scripts/auto-dev/brake.mjs <input.json>`. If exit 1 → write a brake ledger card, append heartbeat, stop.

Brake conditions (any one = stop):
- Lane PR reverted in last 7 days
- After maintenance, lane PR still open > 48h
- 3+ failures in last 7 days
- Weekly DeepSeek cost > $5

## Step 3 — Pick issues

Run `node scripts/auto-dev/pick.mjs <input.json>` with issues from `gh issue list --label auto-dev --state open --json number,author,title,body,labels,createdAt --limit 20`. Pick at most 2, oldest first. Zero = heartbeat + stop.

For each picked issue, also query the last body editor:
```
gh api repos/{owner}/{repo}/issues/<n>/events --jq '[.[] | select(.event=="edited")] | last | .actor.login'
```
If empty (never edited), use the issue author. Pass as `lastEditors` map to pick.mjs.

## Step 4 — For each picked issue

1. Add `auto-dev:in-progress` label.
2. Create working copy: `git clone <github-url> /private/tmp/auto-dev/<issue>/repo --no-local --branch main --single-branch --depth 1`, then `cd` into it, create branch `auto-dev/<issue>-<slug>`.
3. `npm ci` (before any generated code lands).
4. **Content hash snapshot (before)**: `find . -path ./.git -prune -o -type f -print0 | sort -z | xargs -0 sha256sum > /tmp/auto-dev/<issue>/hash-before.txt`
5. **Pre-change baseline** (in sandbox): run verify commands, record exit codes.
6. Generate DeepSeek prompt from issue body (as quoted data) + file list + RULES. Run aider:
   ```
   yes n | sandbox-exec -f "$MAIN_REPO/scripts/auto-dev/sandbox.sb" \
     -D USER_HOME="$HOME" \
     -D WORK_REPO="/private/tmp/auto-dev/<issue>/repo" \
     -D TASK_TMP="/private/tmp/auto-dev/<issue>" \
     -D SANDBOX_HOME="/private/tmp/auto-dev/<issue>/home" \
     -D GIT_DIR="/private/tmp/auto-dev/<issue>/repo/.git" \
     -D WORK_AIDERCONF="/private/tmp/auto-dev/<issue>/repo/.aider.conf.yml" \
     -D WORK_DOTENV="/private/tmp/auto-dev/<issue>/repo/.env" \
     aider --env-file "$MAIN_REPO/.env.local" --model deepseek/deepseek-chat \
       --no-auto-commits --no-auto-lint --map-tokens 0 --no-stream \
       --no-fancy-input --no-detect-urls --no-suggest-shell-commands \
       --no-show-model-warnings --no-check-update \
       --message-file <prompt-file> <allowed-files>
   ```
7. **Content hash snapshot (after)**: same command → `hash-after.txt`. Diff the two: if identical → no changes made, skip to failure.
8. **Commit first** (§5.2 N-3): `git add -A && git commit -m "auto-dev(<issue>): <title>"`. Record commit SHA.
9. **Archive by SHA**: `git archive <SHA> | sha256sum` — record the tarball hash for integrity verification.
10. **Local gates** (§5.2, run from main-trunk read-only copy): `node $MAIN_REPO/scripts/auto-dev/gates.mjs <input.json>` against the changes. Fail → one DeepSeek fix round → re-gate. Still fail → failure (§6).
11. **Independent review** (§5.4): `claude -p --disallowedTools Bash Edit Write NotebookEdit` on the diff. MUST-FIX → one fix round (amend commit, re-archive) → re-review. Still fail → failure.
12. **Push by SHA** (not by branch ref): `git push origin <SHA>:refs/heads/auto-dev/<issue>-<slug>`.
13. Open **draft** PR (§5.6). PR body includes `## 当场试跑` section (see below). Add ledger card (§5.5), push again.
14. Wait for `PR Application Validation` (type-check + build, max 40 min). Both green → `gh pr ready`. Any red or timeout → close PR, failure.
15. **Process group cleanup**: `kill -- -$$` on exit trap (cleanup any child processes from aider/sandbox). Clean up working copy. Remove `auto-dev:in-progress` label.

After that, the Risk gate + Protect main handle the merge.

### 当场试跑 section for PR body

The PR body MUST include a `## 当场试跑` section proving the code works. Generate it by:
1. Run the issue's verify commands against the committed code (in sandbox). Record output.
2. Format as:

```markdown
## 当场试跑

**验证命令**: `npm test -- <path>`
**退出码**: 0
**通过/失败/跳过**: X passed, 0 failed, 0 skipped
**沙箱**: ✅ network denied, ✅ home read denied
**内容哈希**: before `<first 8 chars>` → after `<first 8 chars>` (changed)
```

### Failure handling (§6)

- Issue: remove `auto-dev:in-progress`, add `auto-dev:needs-human`.
- Issue comment (3 parts): **what** (which step + first 20 lines of error, secret-scanned), **how** (split smaller / fix acceptance / hand to human), **href** (branch + PR link).
- Ledger: one PR for all failure + brake cards of this round (branch `auto-dev-ledger/<date>`, only changes `docs/ledger/`). Card uses fixed template only — no raw error text.

### Heartbeat

Append one line to `~/.claude/scheduled-tasks/auto-dev-lane/runs.log` every round (including zero-pick rounds).

Format: `<ISO timestamp> picked=<n>` or `<ISO timestamp> brake: <reason>`.
