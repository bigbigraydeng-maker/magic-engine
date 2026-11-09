#!/bin/bash
# ② 做偏了当场喊 —— 分支跟开窗口时说好的不一样，立刻提醒（每个窗口只喊一次）
source "$HOME/.claude/window-discipline/lib.sh"
IN=$(cat)
CWD=$(printf '%s' "$IN" | jq -r '.cwd // empty')
SID=$(printf '%s' "$IN" | jq -r '.session_id // "x"')
[ -z "$CWD" ] && CWD="$PWD"
echo "$(date '+%m-%d %H:%M:%S') UserPromptSubmit cwd=$CWD" >> "$WD_HOME/cache/hook.log"
wd_is_repo "$CWD" || exit 0

BRIEF="$WD_HOME/briefs/$(wd_brief_file "$CWD").txt"
[ -f "$BRIEF" ] || exit 0

WAS=$(grep '^分支:' "$BRIEF" | cut -d: -f2- | sed 's/^ *//')
NOW=$(wd_branch "$CWD")
[ -z "$WAS" ] && exit 0
[ "$WAS" = "$NOW" ] && exit 0

LOCK="$WD_HOME/locks/${SID}.drift"
[ -f "$LOCK" ] && exit 0
touch "$LOCK"

DOING=$(grep '^在做:' "$BRIEF" | cut -d: -f2- | sed 's/^ *//')
MSG="【偏离提醒】这个窗口开的时候说的是「$DOING」（分支 $WAS），现在人在分支 $NOW 上。
先跟用户确认一句：是同一件事换了分支，还是已经变成另一件活儿了？
如果是另一件活儿 —— 直说「这该另开一个窗口」，别在这个窗口里接着做。
如果是同一件事 —— 把 $BRIEF 里的「分支:」改成 $NOW。
用大白话说，一次只问这一件事。"
CARD="⚠️ 跑偏提醒：这个窗口开的时候说的是「$DOING」（分支 $WAS），现在人在分支 $NOW 上。"
jq -nc --arg c "$MSG" --arg m "$CARD" \
  '{hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext:$c}, systemMessage:$m}'
exit 0
