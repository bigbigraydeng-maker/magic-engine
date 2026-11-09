#!/bin/bash
# 窗口纪律 · 公共函数
WD_HOME="$HOME/.claude/window-discipline"

wd_brief_file() {
  # $1 = cwd ；用路径的 md5 当文件名，契约不落在 git 仓库里，不污染 git status
  printf '%s' "$1" | md5 -q 2>/dev/null || printf '%s' "$1" | md5sum | cut -d' ' -f1
}

wd_git() { git -C "$1" "${@:2}" 2>/dev/null; }

wd_is_repo() { git -C "$1" rev-parse --git-dir >/dev/null 2>&1; }

# 把当前目录规范化成仓库根 —— 从子目录开窗口时 $1 可能是 /repo/subdir，
# 而 git worktree list 报的永远是仓库根 /repo，两者不比对齐会把自己当成别的窗口。
wd_toplevel() { wd_git "$1" rev-parse --show-toplevel || printf '%s' "$1"; }

wd_branch() { wd_git "$1" rev-parse --abbrev-ref HEAD; }

wd_dirty_count() { wd_git "$1" status --porcelain | grep -c . | tr -d ' '; }

# 欠账缓存按仓库区分（用 git-common-dir 当 key，同一仓库的所有工作副本共享一份），
# 缓存里存的是不排除任何人的完整每副本统计，排除 $self 放到读取时做——
# 这样窗口 A 刷新的缓存，窗口 B 读的时候也能正确排除 B 自己，不会互相顶掉。
wd_debt_cache_key() {
  local common_dir
  common_dir=$(wd_git "$1" rev-parse --git-common-dir)
  [ -z "$common_dir" ] && return 1
  case "$common_dir" in
    /*) : ;;
    *) common_dir="$1/$common_dir" ;;
  esac
  printf '%s' "$common_dir" | md5 -q 2>/dev/null || printf '%s' "$common_dir" | md5sum | cut -d' ' -f1
}

wd_debt_line() {
  local self
  self=$(wd_toplevel "$1")
  local key cache
  key=$(wd_debt_cache_key "$self") || return
  cache="$WD_HOME/cache/debt-$key.txt"
  [ -f "$cache" ] || return
  local total_wt=0 total_files=0 wt n
  while IFS=$'\t' read -r wt n; do
    [ -z "$wt" ] && continue
    [ "$wt" = "$self" ] && continue
    if [ "${n:-0}" -gt 0 ]; then
      total_wt=$((total_wt+1)); total_files=$((total_files+n))
    fi
  done < "$cache"
  if [ "$total_wt" -gt 0 ]; then
    printf '另有 %s 个窗口躺着 %s 个没提交的文件' "$total_wt" "$total_files"
  else
    printf '其他窗口都收干净了'
  fi
}

wd_refresh_debt_bg() {
  local self
  self=$(wd_toplevel "$1")
  local key
  key=$(wd_debt_cache_key "$self") || return
  (
    local cache="$HOME/.claude/window-discipline/cache/debt-$key.txt"
    local tmp="$cache.tmp.$$"
    : > "$tmp"
    while IFS= read -r wt; do
      [ -z "$wt" ] && continue
      local n
      n=$(git -C "$wt" status --porcelain 2>/dev/null | grep -c . | tr -d ' ')
      printf '%s\t%s\n' "$wt" "${n:-0}" >> "$tmp"
    done < <(git -C "$self" worktree list --porcelain 2>/dev/null | sed -n 's/^worktree //p')
    mv "$tmp" "$cache"
  ) >/dev/null 2>&1 &
}
