#!/usr/bin/env bash
# 夜巡分支形状检查（CI）。
#
# 为什么要有这个：
#   夜巡（claude/ledger-verify-*）是机器自动翻台账状态的通道。它一旦能顺手改代码、
#   改标题、改 decided_on，就等于机器可以悄悄重写「当初决定了什么」——台账就废了。
#   on_hold 同理：README 规定它只能由 PM 主动重提后人工解除，机器把 decided 卡
#   悄悄标成 on_hold: true 就等于让该事项永久从待办消失，所以也必须冻结。
#   所以这条分支只准动 status / done_on / done_ref / verified_ref / last_checked /
#   check_note，只准动 docs/ledger/ 下的卡和 evidence/ 里的证据，且不准新建卡。
set -euo pipefail

FAILS=()

# field <file> <key> —— 取 ^key: 的第一个值，去空白、去 \r
field() {
  local f="$1" key="$2"
  grep -m1 -E "^${key}:" "$f" 2>/dev/null \
    | sed -E "s/^${key}:[[:space:]]*//" \
    | tr -d '\r' || true
}

# field_at <sha> <file> <key> —— 从某个 commit 的版本里取字段
field_at() {
  local sha="$1" f="$2" key="$3"
  local tmp
  tmp="$(mktemp)"
  if git show "${sha}:${f}" >"$tmp" 2>/dev/null; then
    field "$tmp" "$key"
  fi
  rm -f "$tmp"
}

changed="$(git diff --name-only "$BASE_SHA...$HEAD_SHA")"

# ---- 1. 只准动 docs/ledger/ 下的卡和 evidence/ ----
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  if ! [[ "$f" =~ ^docs/ledger/([^/]+|evidence/[^/]+)\.md$ ]]; then
    FAILS+=("夜巡分支只准动 docs/ledger/ 里的卡和 docs/ledger/evidence/ 里的证据（越界：${f}）")
  fi
done <<<"$changed"

# ---- 2. 已存在的卡：冻结字段不准变 ----
frozen_keys=(id title decided_on source verify_by verify_how owner on_hold)
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  # 只处理顶层卡
  [[ "$f" =~ ^docs/ledger/[^/]+\.md$ ]] || continue
  [[ "$(basename "$f")" == "README.md" ]] && continue
  # 必须 BASE 里已存在
  git cat-file -e "${BASE_SHA}:${f}" 2>/dev/null || continue

  for key in "${frozen_keys[@]}"; do
    old="$(field_at "$BASE_SHA" "$f" "$key")"
    new="$(field "$f" "$key")"
    if [[ "$old" != "$new" ]]; then
      if [[ "$key" == "owner" && "$old" == "agent" && "$new" == "pm" ]]; then
        continue
      fi
      FAILS+=("${f} 改了冻结字段 ${key}（夜巡只准改 status / done_on / done_ref / verified_ref / last_checked / check_note）")
    fi
  done
done <<<"$changed"

# ---- 3. 不准新建卡（evidence 不算卡） ----
added="$(git diff --name-only --diff-filter=A "$BASE_SHA...$HEAD_SHA" || true)"
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  if [[ "$f" =~ ^docs/ledger/[^/]+\.md$ ]]; then
    FAILS+=("夜巡分支不准新建卡（${f}）")
  fi
done <<<"$added"

# ---- 4. 汇总 ----
if [[ "${#FAILS[@]}" -gt 0 ]]; then
  for msg in "${FAILS[@]}"; do
    echo "::error::${msg}"
  done
  exit 1
fi

echo "verify-branch shape ok"
