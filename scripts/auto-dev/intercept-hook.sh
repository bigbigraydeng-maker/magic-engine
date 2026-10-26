#!/usr/bin/env bash
# Auto-dev lane PreToolUse intercept hook (v2 — DR75-3 rewrite).
# Blocks dangerous commands in the lane session.
#
# Session scoping: only active when CLAUDE_SESSION_DIR contains
# "auto-dev" — non-lane sessions pass through untouched.
#
# Input: JSON on stdin with { tool_name, tool_input }
# Output: JSON { "decision": "allow" } or { "decision": "block", "reason": "..." }

set -euo pipefail

INPUT=$(cat)

# ── session scope check: only intercept auto-dev lane sessions ──
SESSION_DIR="${CLAUDE_SESSION_DIR:-}"
if [[ "$SESSION_DIR" != *auto-dev* ]]; then
  echo '{"decision":"allow"}'
  exit 0
fi

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')

# Only intercept Bash tool calls
if [ "$TOOL_NAME" != "Bash" ]; then
  echo '{"decision":"allow"}'
  exit 0
fi

CMD=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

# ── blocked patterns ──
# Each pattern is checked with grep -F (fixed string) or grep -P (pcre)
# to avoid treating patterns like --admin as grep flags.

FIXED_BLOCKED=(
  "--admin"
  "gh secret"
  "gh variable"
  "gh api -X"
  "gh api --method"
  "gh api -f "
  "gh repo edit"
  "gh ruleset"
  "gh auth"
  "gh pr merge"
  "git push --force"
  "git push -f "
)

for pattern in "${FIXED_BLOCKED[@]}"; do
  if echo "$CMD" | grep -qF -- "$pattern"; then
    echo "{\"decision\":\"block\",\"reason\":\"auto-dev lane: blocked pattern '${pattern}'\"}"
    exit 0
  fi
done

# ── regex patterns (need pcre or extended regex) ──
# Push to main: match "git push" followed by "main" or "master" as a word boundary
# but not when pushing a branch like "auto-dev/123-foo" (which is fine)
if echo "$CMD" | grep -qE 'git push[^|;]*\b(main|master)\b'; then
  echo '{"decision":"block","reason":"auto-dev lane: push to main/master blocked"}'
  exit 0
fi

# Force push variants
if echo "$CMD" | grep -qF -- "--force-with-lease"; then
  echo '{"decision":"block","reason":"auto-dev lane: force push blocked"}'
  exit 0
fi

echo '{"decision":"allow"}'
