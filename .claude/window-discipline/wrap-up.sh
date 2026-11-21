#!/bin/bash
# ③ 关窗口前拦一下 —— 有没提交的文件就拦住，逼出「合了 / 开了 / 写了」三选一
source "$HOME/.claude/window-discipline/lib.sh"
IN=$(cat)
CWD=$(printf '%s' "$IN" | jq -r '.cwd // empty')
SID=$(printf '%s' "$IN" | jq -r '.session_id // "x"')
ACTIVE=$(printf '%s' "$IN" | jq -r '.stop_hook_active // false')
[ "$ACTIVE" = "true" ] && exit 0          # 防死循环：已经因为本 hook 续过一次就放行
[ -z "$CWD" ] && CWD="$PWD"
echo "$(date '+%m-%d %H:%M:%S') Stop cwd=$CWD" >> "$WD_HOME/cache/hook.log"
wd_is_repo "$CWD" || exit 0

DIRTY=$(wd_dirty_count "$CWD")
[ "${DIRTY:-0}" -eq 0 ] && exit 0

LOCK="$WD_HOME/locks/${SID}.wrapup"
[ -f "$LOCK" ] && exit 0                   # 每个窗口只拦一次，不烦人
touch "$LOCK"

BR=$(wd_branch "$CWD")
FILES=$(wd_git "$CWD" status --porcelain | head -8 | sed 's/^/  /')
jq -nc --arg r "这个窗口还有 $DIRTY 个文件没提交（分支 $BR）：
$FILES

收尾前用大白话问用户一次，三选一：
  合了 —— 已经进 main，那就把这个工作副本删掉
  开了 —— 开个 PR 推上去，本地丢了也不心疼
  写了 —— 真没做完，就在 docs/ROADMAP.md 写清停在哪、下一步做什么
说完就停，别自己替用户决定，也别重复问第二次。" '{decision:"block",reason:$r}'
exit 0
