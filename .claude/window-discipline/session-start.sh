#!/bin/bash
# ① 开窗口自动报到 —— 每次进窗口/恢复/压缩后，先说清楚这个窗口在做什么
source "$HOME/.claude/window-discipline/lib.sh"
IN=$(cat)
CWD=$(printf '%s' "$IN" | jq -r '.cwd // empty')
SRC=$(printf '%s' "$IN" | jq -r '.source // empty')
[ -z "$CWD" ] && CWD="$PWD"

echo "$(date '+%m-%d %H:%M:%S') SessionStart source=$SRC cwd=$CWD" >> "$WD_HOME/cache/hook.log"

wd_is_repo "$CWD" || { echo "  └ 不是 git 仓库，跳过" >> "$WD_HOME/cache/hook.log"; exit 0; }

BR=$(wd_branch "$CWD")
LAST=$(wd_git "$CWD" log -1 --format='%cr · %s')
DIRTY=$(wd_dirty_count "$CWD")
BRIEF="$WD_HOME/briefs/$(wd_brief_file "$CWD").txt"

# 推没推到远端 —— 纯本地判断，不联网，秒回
if wd_git "$CWD" rev-parse --verify "origin/$BR" >/dev/null; then
  AHEAD=$(wd_git "$CWD" rev-list --count "origin/$BR..HEAD")
  if [ "${AHEAD:-0}" -gt 0 ]; then REMOTE="有 $AHEAD 次改动还没推上去"; else REMOTE="已经推上去了"; fi
else
  REMOTE="⚠️ 这个分支从没推到远端，东西只在这台机器上"
fi

wd_refresh_debt_bg "$CWD"
DEBT=$(wd_debt_line "$CWD")
DIRTY_TXT=$([ "${DIRTY:-0}" -gt 0 ] && echo "$DIRTY 个文件还没提交" || echo "干净")

if [ -f "$BRIEF" ]; then
  DOING=$(grep '^在做:' "$BRIEF" | cut -d: -f2- | sed 's/^ *//')
  STOP=$(grep '^做完就停:' "$BRIEF" | cut -d: -f2- | sed 's/^ *//')
  TIER=$(grep '^风险级:' "$BRIEF" | cut -d: -f2- | sed 's/^ *//')
  CARD="┌─ 这个窗口在做什么 ─────────────
│ 在做　　　$DOING
│ 做完就停　$STOP
│ 强度　　　$TIER 级
├────────────────────────────
│ 分支　　　$BR
│ 上次改动　$LAST
│ 本地　　　$DIRTY_TXT
│ 远端　　　$REMOTE
$([ -n "$DEBT" ] && echo "│ 其他窗口　$DEBT")
└────────────────────────────"
  INSTR="【回答用户前的第一件事】把下面这张卡原样贴出来给用户看（照抄，别改写、别总结、别只挑几行），贴完再干活：

$CARD

之后说人话、先结论、一次一件事。"
else
  CARD="┌─ 这个窗口还没定目标 ───────────
│ 分支　　　$BR
│ 上次改动　$LAST
│ 本地　　　$DIRTY_TXT
│ 远端　　　$REMOTE
$([ -n "$DEBT" ] && echo "│ 其他窗口　$DEBT")
└────────────────────────────"
  INSTR="上面这张卡已经显示给用户了，不用复述。
【必做】用户说明来意后，立刻把四行契约写进这个文件（用 Write 工具，路径照抄）：
$BRIEF
格式（照抄字段名）：
在做: <一句话说清这个窗口干什么>
做完就停: <一个可验证的终点，例如「PR 开出来就停」>
风险级: A 或 B 或 C
分支: $BR
定级参考 docs/ENGINEERING_QUALITY_GATES.md：A=安全/改库/发钱/发布，B=普通业务，C=界面文案/原型。
写完顺手把窗口标题设成「在做」那句话（set_session_title）。
说人话、先结论、一次一件事。"
fi

if [ "$SRC" = "compact" ]; then
  CARD="（刚压缩过上下文，重新对一次目标，别跑偏）
$CARD"
fi

jq -nc --arg c "$INSTR" --arg m "$CARD" \
  '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$c}, systemMessage:$m}'
exit 0
