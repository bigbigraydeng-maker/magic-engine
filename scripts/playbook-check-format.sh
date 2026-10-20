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
  # Exclude date patterns (YYYY-MM-DD) and code fences
  if grep -En '[0-9]{10,}' "$f" | grep -v -E '^\d+:.*```' | grep -q .; then
    fail "$relpath" "contains 10+ consecutive digits (potential client data leak)"
  fi

  # --- pr: and issue: pointers require GH_TOKEN and must exist ---
  while IFS= read -r pr_line; do
    [[ -z "$pr_line" ]] && continue
    pr_num="${pr_line##*pr:}"
    pr_num="${pr_num%%[^0-9]*}"
    if [[ -z "${GH_TOKEN:-}" ]]; then
      fail "$relpath" "contains pr:$pr_num but GH_TOKEN is not set (cannot verify)"
    else
      if ! gh api "repos/{owner}/{repo}/pulls/$pr_num" --silent 2>/dev/null; then
        fail "$relpath" "pr:$pr_num does not exist or is inaccessible"
      fi
    fi
  done < <(grep -oE 'pr:[0-9]+' "$f" | sort -u)

  while IFS= read -r issue_line; do
    [[ -z "$issue_line" ]] && continue
    issue_num="${issue_line##*issue:}"
    issue_num="${issue_num%%[^0-9]*}"
    if [[ -z "${GH_TOKEN:-}" ]]; then
      fail "$relpath" "contains issue:$issue_num but GH_TOKEN is not set (cannot verify)"
    else
      if ! gh api "repos/{owner}/{repo}/issues/$issue_num" --silent 2>/dev/null; then
        fail "$relpath" "issue:$issue_num does not exist or is inaccessible"
      fi
    fi
  done < <(grep -oE 'issue:[0-9]+' "$f" | sort -u)

  # --- doc: pointers must point to existing files (with optional anchor) ---
  while IFS= read -r doc_ptr; do
    [[ -z "$doc_ptr" ]] && continue
    doc_path="${doc_ptr#doc:}"
    doc_file="${doc_path%%#*}"
    if [[ ! -f "$doc_file" ]]; then
      fail "$relpath" "doc:$doc_path — file does not exist"
    elif [[ "$doc_path" == *"#"* ]]; then
      anchor="${doc_path##*#}"
      if ! grep -qi "^#.*$anchor" "$doc_file" 2>/dev/null; then
        fail "$relpath" "doc:$doc_path — anchor '#$anchor' not found in file"
      fi
    fi
  done < <(grep -oE 'doc:[^ ,)]+' "$f" | sort -u)

  # --- commit: pointers must exist in git ---
  while IFS= read -r commit_ptr; do
    [[ -z "$commit_ptr" ]] && continue
    sha="${commit_ptr#commit:}"
    if ! git cat-file -t "$sha" >/dev/null 2>&1; then
      fail "$relpath" "commit:$sha does not exist in repository"
    fi
  done < <(grep -oE 'commit:[a-f0-9]+' "$f" | sort -u)

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
