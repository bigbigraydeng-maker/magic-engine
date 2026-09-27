#!/usr/bin/env bash
# 台账冻结字段检查（CI）。
#
# 比对 PR 修改的台账文件，检查已在 base 上的卡是否被改写了冻结字段
# （id / title / decided_on / source / verify_by / verify_how）。
# 新卡（base 上不存在）不受此规则约束。
set -euo pipefail

base="${BASE_SHA:?BASE_SHA is required}"
head="${HEAD_SHA:?HEAD_SHA is required}"

FAILS=()

# 取被修改的台账文件（不含新增、不含 README）
modified=$(git diff --name-only --diff-filter=M "$base...$head" -- 'docs/ledger/*.md' | grep -v 'README\.md' || true)

if [[ -z "$modified" ]]; then
  echo "没有修改过的台账文件，跳过冻结字段检查"
  exit 0
fi

# field <text> <key> —— 从文本中取 ^key: 的第一个值
field_from_text() {
  local text="$1" key="$2"
  echo "$text" | grep -m1 -E "^${key}:" | sed -E "s/^${key}:[[:space:]]*//" | tr -d '\r' || true
}

frozen_keys=(id title decided_on source verify_by verify_how)

while IFS= read -r f; do
  [[ -z "$f" ]] && continue

  # 取 base 版本
  base_text=$(git show "${base}:${f}" 2>/dev/null || true)
  if [[ -z "$base_text" ]]; then
    continue
  fi

  # 取 head 版本
  head_text=$(git show "${head}:${f}" 2>/dev/null || true)
  if [[ -z "$head_text" ]]; then
    continue
  fi

  for key in "${frozen_keys[@]}"; do
    old_val=$(field_from_text "$base_text" "$key")
    new_val=$(field_from_text "$head_text" "$key")
    if [[ "$old_val" != "$new_val" ]]; then
      FAILS+=("${f}：冻结字段 ${key} 被改写（原来「${old_val}」→ 现在「${new_val}」）。改了判据等于换了一张卡，请新建")
    fi
  done
done <<<"$modified"

if [[ "${#FAILS[@]}" -gt 0 ]]; then
  for msg in "${FAILS[@]}"; do
    echo "::error::${msg}"
  done
  exit 1
fi

echo "冻结字段检查通过"
