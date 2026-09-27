#!/usr/bin/env bash
# 经验手册格式检查（CI）。
#
# 检查 docs/playbooks/ 下的正文手册（general.md、industry-*.md）是否符合
# 设计稿 §3.2 的固定格式。比台账检查更严：
#   - 禁止 session: 指针
#   - 禁止指向手册自身
#   - 没有 GH_TOKEN 时 pr: / issue: 判不通过
#   - 正文不许含 10 位以上连续数字
# inbox.md 是候选区，不检查。
set -euo pipefail

FAILS=()
fail() { FAILS+=("$1: $2"); }

PLAYBOOK_DIR="docs/playbooks"
if [[ ! -d "$PLAYBOOK_DIR" ]]; then
  echo "⚠ $PLAYBOOK_DIR not found — skipping playbook format check"
  exit 0
fi

# Collect body files (not inbox.md)
FILES=()
while IFS= read -r f; do
  FILES+=("$f")
done < <(find "$PLAYBOOK_DIR" -name '*.md' ! -name 'inbox.md' -type f | sort)

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "⚠ No playbook body files found — skipping"
  exit 0
fi

echo "Checking ${#FILES[@]} playbook body files…"

for f in "${FILES[@]}"; do
  basename_f="$(basename "$f")"
  relpath="$f"

  # --- §3.2 required fields per section ---
  # Each ## heading starts a section; each section needs the 5 fields
  section_count=0
  in_section=""
  has_rule=false
  has_why=false
  has_how=false
  has_level=false
  has_date=false

  flush_section() {
    if [[ -n "$in_section" ]]; then
      $has_rule  || fail "$relpath" "section '$in_section': missing '规律：'"
      $has_why   || fail "$relpath" "section '$in_section': missing '为什么：'"
      $has_how   || fail "$relpath" "section '$in_section': missing '怎么用：'"
      $has_level || fail "$relpath" "section '$in_section': missing '证据等级：'"
      $has_date  || fail "$relpath" "section '$in_section': missing '最后核实：'"
    fi
  }

  while IFS= read -r line; do
    if [[ "$line" =~ ^##\  ]]; then
      flush_section
      in_section="${line#\#\# }"
      section_count=$((section_count + 1))
      has_rule=false; has_why=false; has_how=false; has_level=false; has_date=false
    fi
    [[ "$line" =~ ^-\ 规律[：:] ]] && has_rule=true
    [[ "$line" =~ ^-\ 为什么[：:] ]] && has_why=true
    [[ "$line" =~ ^-\ 怎么用[：:] ]] && has_how=true
    [[ "$line" =~ ^-\ 证据等级[：:] ]] && has_level=true
    [[ "$line" =~ ^-\ 最后核实[：:] ]] && has_date=true
  done < "$f"
  flush_section

  if [[ $section_count -eq 0 ]]; then
    fail "$relpath" "no ## sections found"
  fi

  # --- Forbidden: session: pointers ---
  if grep -qn 'session:' "$f"; then
    fail "$relpath" "contains 'session:' pointer (forbidden in playbooks)"
  fi

  # --- Forbidden: self-reference ---
  if grep -qn "doc:${relpath}" "$f"; then
    fail "$relpath" "contains self-reference pointer"
  fi

  # --- Forbidden: 10+ consecutive digits ---
  # Exclude date patterns (YYYY-MM-DD) and code paths
  if grep -Pn '(?<!\d)(\d{10,})(?!\d)' "$f" 2>/dev/null | grep -v -E '^\d+:.*```' | grep -q .; then
    fail "$relpath" "contains 10+ consecutive digits (potential client data leak)"
  fi

  # --- pr: and issue: pointers require GH_TOKEN ---
  if grep -qE '(pr:|issue:)\d+' "$f"; then
    if [[ -z "${GH_TOKEN:-}" ]]; then
      fail "$relpath" "contains pr:/issue: pointers but GH_TOKEN is not set (cannot verify)"
    fi
  fi

  # --- Evidence pointer format check ---
  # Each "为什么" line should have · 证据：<pointer>
  while IFS= read -r line; do
    if [[ "$line" =~ ^-\ 为什么 ]] && ! [[ "$line" =~ 证据[：:] ]]; then
      fail "$relpath" "'为什么' line missing '证据：' field: ${line:0:80}…"
    fi
  done < "$f"

  # --- 证据等级 must be one of two values ---
  while IFS= read -r line; do
    if [[ "$line" =~ ^-\ 证据等级[：:] ]]; then
      if ! [[ "$line" =~ (单客户候选|多客户已验证) ]]; then
        fail "$relpath" "invalid 证据等级 (must be '单客户候选' or '多客户已验证'): $line"
      fi
    fi
  done < "$f"
done

# --- Report ---
echo ""
if [[ ${#FAILS[@]} -eq 0 ]]; then
  echo "✅ All ${#FILES[@]} playbook body files pass format check"
  exit 0
else
  echo "❌ ${#FAILS[@]} format issue(s) found:"
  for msg in "${FAILS[@]}"; do
    echo "  - $msg"
  done
  exit 1
fi
