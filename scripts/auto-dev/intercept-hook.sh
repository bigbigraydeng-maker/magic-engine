#!/usr/bin/env bash
# Auto-dev lane PreToolUse intercept hook.
# Blocks dangerous commands in the lane session.
#判定依据：会话记录路径（不受 cd 影响）。
# 非车道会话不受影响。
#
# Input: JSON on stdin with { tool_name, tool_input }
# Output: JSON { "decision": "allow" } or { "decision": "block", "reason": "..." }

set -euo pipefail

INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')

# Only intercept Bash tool calls
if [ "$TOOL_NAME" != "Bash" ]; then
  echo '{"decision":"allow"}'
  exit 0
fi

CMD=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

# List of blocked patterns
BLOCKED_PATTERNS=(
  "--admin"
  "gh variable"
  "gh secret"
  "gh api -X"
  "gh api --method"
  "gh repo edit"
  "gh ruleset"
  "gh auth"
  "git push --force"
  "git push -f "
  "git push.*main"
)

for pattern in "${BLOCKED_PATTERNS[@]}"; do
  if echo "$CMD" | grep -qE "$pattern"; then
    echo "{\"decision\":\"block\",\"reason\":\"auto-dev lane: blocked pattern '$pattern'\"}"
    exit 0
  fi
done

echo '{"decision":"allow"}'
