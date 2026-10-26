#!/usr/bin/env bash
# 台账指针检查（CI）。
#
# 为什么要有这个：
#   台账卡里写的 source / done_ref / verified_ref 是「这张卡凭什么算数」的证据。
#   以前这些指针只是文字，写错、写死、指向别人的 PR 都没人发现 —— 于是台账可以
#   看起来写满了，实际全是空头支票。这个脚本把每个指针拿去真查一遍，并且要求
#   本 PR 至少有一张卡是新建的、或明确指向本 PR，否则「改一个字」就能骗过闸门。
#   只读：不评论、不推送、不部署。
set -euo pipefail

FAILS=()

# field <file> <key> —— 取 ^key: 的第一个值，去空白、去 \r
field() {
  local f="$1" key="$2"
  grep -m1 -E "^${key}:" "$f" 2>/dev/null \
    | sed -E "s/^${key}:[[:space:]]*//" \
    | tr -d '\r' || true
}

# 同一个 PR 号在一次运行里只查一次（结果记在临时目录的文件里；pr_state 是在 $(...) 子进程里调的，
# 不能用变量记）。查不到也记，免得同一个坏编号重复烧额度。
CACHE_DIR="$(mktemp -d)"
trap 'rm -rf "$CACHE_DIR"' EXIT

# ledger_diff [git diff 参数...] —— 打印「BASE...HEAD 之间 docs/ledger 下改动的文件名」。
# git 算不出来（BASE_SHA/HEAD_SHA 不可用、浅克隆没有基点……）时不能当成「没有改动」：
# 记一个标志，最后统一报红（失败即红，不会悄悄变成「0 张卡被核对」而误绿）。
DIFF_FAIL_FLAG="${CACHE_DIR}/diff-failed"
ledger_diff() {
  local out
  if ! out="$(git -c core.quotepath=false diff --name-only "$@" "$BASE_SHA...$HEAD_SHA" -- 'docs/ledger/*.md' 2>/dev/null)"; then
    : > "$DIFF_FAIL_FLAG"
    return 0
  fi
  printf '%s\n' "$out"
}

# pr_state <n> —— 打印 open 或合并时间戳；查不到则非零退出；无凭据则打印 skip
pr_state() {
  local n="$1"
  if [[ -z "${GH_TOKEN:-}" || -z "${GITHUB_REPOSITORY:-}" ]]; then
    echo "skip"
    return 0
  fi
  local cache="${CACHE_DIR}/pr-${n}"
  if [[ -f "$cache" ]]; then
    local cached
    cached="$(cat "$cache")"
    if [[ "$cached" == "__ERR__" ]]; then
      return 1
    fi
    echo "$cached"
    return 0
  fi
  local out
  if out="$(gh api "repos/${GITHUB_REPOSITORY}/pulls/${n}" --jq '.merged_at // "open"')" && [[ -n "$out" ]]; then
    printf '%s' "$out" > "$cache"
    echo "$out"
    return 0
  fi
  printf '%s' "__ERR__" > "$cache"
  return 1
}

# check_exists <file> <key> <ref> —— 按 kind 校验指针是否真实存在
check_exists() {
  local file="$1" key="$2" ref="$3"
  local kind="${ref%%:*}"
  local value="${ref#*:}"
  local ok=0

  case "$kind" in
    pr)
      local st
      if st="$(pr_state "$value" 2>/dev/null)"; then ok=1; fi
      ;;
    issue)
      if [[ -z "${GH_TOKEN:-}" || -z "${GITHUB_REPOSITORY:-}" ]]; then
        ok=1
      elif gh api "repos/${GITHUB_REPOSITORY}/issues/${value}" >/dev/null 2>&1; then
        ok=1
      fi
      ;;
    commit)
      if git cat-file -e "${value}^{commit}" 2>/dev/null; then ok=1; fi
      ;;
    doc)
      if [[ -e "$value" ]]; then ok=1; fi
      ;;
    session)
      ok=1
      ;;
    url)
      if [[ "$value" =~ ^https://github\.com/[^/]+/[^/]+/pull/([0-9]+)$ ]]; then
        local st
        if st="$(pr_state "${BASH_REMATCH[1]}" 2>/dev/null)"; then ok=1; fi
      elif [[ "$value" =~ ^https://github\.com/[^/]+/[^/]+/issues/([0-9]+)$ ]]; then
        if [[ -z "${GH_TOKEN:-}" || -z "${GITHUB_REPOSITORY:-}" ]]; then
          ok=1
        elif gh api "repos/${GITHUB_REPOSITORY}/issues/${BASH_REMATCH[1]}" >/dev/null 2>&1; then
          ok=1
        fi
      elif [[ "$value" =~ ^https://github\.com/[^/]+/[^/]+/commit/([0-9a-fA-F]+)$ ]]; then
        if git cat-file -e "${BASH_REMATCH[1]}^{commit}" 2>/dev/null; then ok=1; fi
      elif [[ "$value" =~ ^https?:// ]]; then
        ok=1
      fi
      ;;
    *)
      ok=0
      ;;
  esac

  if [[ "$ok" -ne 1 ]]; then
    FAILS+=("${file} ${key}=${ref} — 查不到")
  fi
}

# ---- 1. 每张卡的指针都要真实存在 ----
# PR 上下文里只核对「本 PR 新增/改动的卡」：已合并的旧卡在它们自己的 PR 里查过了，每个 PR 都把
# 全库两百多张卡重查一遍，会把 CI 自带令牌每小时约 1000 次的额度烧光，之后所有 PR 的这项检查
# （和同样要调接口的风险门、改动范围检查）一起变红，重跑只会烧得更快（2026-10-14 实测）。
# 没有 PR 上下文（本机/定时任务），或设了 LEDGER_REFS_FULL=1，仍然全库核对。
# 失败照旧是关的：改动的卡里有查不到的指针，一律红；接口超限时对改动卡也是红，不会误绿。
all_cards=()
for f in docs/ledger/*.md; do
  [[ -e "$f" ]] || continue
  [[ "$(basename "$f")" == "README.md" ]] && continue
  all_cards+=("$f")
done

cards_to_check=("${all_cards[@]+"${all_cards[@]}"}")
if [[ -n "${BASE_SHA:-}" && -n "${HEAD_SHA:-}" && "${LEDGER_REFS_FULL:-}" != "1" ]]; then
  cards_to_check=()
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    [[ "$f" =~ ^docs/ledger/[^/]+\.md$ ]] || continue
    [[ "$(basename "$f")" == "README.md" ]] && continue
    [[ -e "$f" ]] || continue
    cards_to_check+=("$f")
  done < <(ledger_diff --diff-filter=AMR)
fi

# 本地能查、不花接口额度的指针（commit: / doc:）对全库每张卡都查 —— 文档被改名或删除是最容易悄悄变坏的。
# pr: / issue: / url: 只对上面选出的卡查（要调接口）。
checked_list="$(printf '%s\n' "${cards_to_check[@]+"${cards_to_check[@]}"}")"
for f in "${all_cards[@]+"${all_cards[@]}"}"; do
  in_scope=0
  if grep -qxF -- "$f" <<<"$checked_list"; then in_scope=1; fi
  for key in source done_ref verified_ref; do
    val="$(field "$f" "$key")"
    [[ -n "$val" ]] || continue
    kind="${val%%:*}"
    if [[ "$in_scope" -eq 1 || "$kind" == "commit" || "$kind" == "doc" ]]; then
      check_exists "$f" "$key" "$val"
    fi
  done
done

# ---- 2. PR 上下文下的绑定规则 ----
if [[ -n "${BASE_SHA:-}" && -n "${HEAD_SHA:-}" && -n "${PR_NUMBER:-}" ]]; then
  changed="$(ledger_diff | grep -v 'README\.md' || true)"
  added="$(ledger_diff --diff-filter=A | grep -v 'README\.md' || true)"

  # git 的通配会穿过 /，evidence/ 里的证据文件不是卡，别按卡的规则查
  changed="$(grep -E '^docs/ledger/[^/]+\.md$' <<<"$changed" || true)"
  added="$(grep -E '^docs/ledger/[^/]+\.md$' <<<"$added" || true)"

  if [[ -n "$changed" ]]; then
    bound=0
    while IFS= read -r f; do
      [[ -z "$f" ]] && continue
      if grep -qxF "$f" <<<"$added"; then
        bound=1
        break
      fi
      dref="$(field "$f" done_ref)"
      src="$(field "$f" source)"
      if [[ "$dref" == "pr:${PR_NUMBER}" || "$src" == "pr:${PR_NUMBER}" ]]; then
        bound=1
        break
      fi
    done <<<"$changed"

    if [[ "$bound" -ne 1 ]]; then
      FAILS+=("本 PR 改了台账但没有一张卡是新建的，也没有一张卡指向 pr:${PR_NUMBER}——改一个字不算写台账")
    fi
  fi

  # 新建的卡不能一出生就是 decided/done 之外的状态
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    status="$(field "$f" status)"
    if [[ "$status" != "decided" && "$status" != "done" ]]; then
      FAILS+=("${f} 新建的卡不能一出生就是 ${status}——先 done，等夜巡或人核过再翻")
    fi
  done <<<"$added"

  # done_ref 指向别的 PR 时，那个 PR 必须已经合并
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    dref="$(field "$f" done_ref)"
    if [[ "$dref" =~ ^pr:([0-9]+)$ ]]; then
      n="${BASH_REMATCH[1]}"
      if [[ "$n" != "$PR_NUMBER" ]]; then
        st="$(pr_state "$n" 2>/dev/null || echo skip)"
        if [[ "$st" == "open" ]]; then
          FAILS+=("${f} done_ref=pr:${n} 指向一个还没合并的别的 PR")
        fi
      fi
    fi
  done <<<"$changed"
fi

if [[ -f "$DIFF_FAIL_FLAG" ]]; then
  FAILS+=("算不出本 PR 改了哪些台账卡（BASE_SHA/HEAD_SHA 不可用或 git diff 失败）——按失败处理，不当成「没有改动」")
fi

# ---- 3. 汇总 ----
if [[ "${#FAILS[@]}" -gt 0 ]]; then
  echo "::error::台账检查没过："
  for msg in "${FAILS[@]}"; do
    echo "$msg"
  done
  exit 1
fi

echo "ledger refs ok (checked ${#cards_to_check[@]} of ${#all_cards[@]} cards)"
