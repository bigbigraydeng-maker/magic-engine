#!/bin/bash
# 窗口纪律 · 一条命令装回来
#   bash .claude/window-discipline/install.sh
# 幂等：重复跑不会装两遍，也不会覆盖已有配置。
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DST="$HOME/.claude/window-discipline"
SETTINGS="$HOME/.claude/settings.json"

command -v jq >/dev/null || { echo "❌ 需要 jq，先跑：brew install jq"; exit 1; }

echo "① 放脚本 → $DST"
mkdir -p "$DST"/{briefs,cache,locks}
for f in lib.sh session-start.sh drift-check.sh wrap-up.sh README.md; do
  cp "$SRC/$f" "$DST/$f"
done
chmod +x "$DST"/*.sh

echo "② 挂三个提醒 → $SETTINGS"
[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"
cp "$SETTINGS" "$SETTINGS.bak-$(date +%Y%m%d-%H%M%S)"

#   只摘掉带本工具标记（$d 路径）的内层 hook 命令，同一条目里挂的其他工具
#   （比如 scripts/team-memory/install.mjs 挂的 SessionStart/Stop）原样保留；
#   只有摘完内层数组变空的条目才整条丢弃。
jq --arg d "$DST" '
  def strip_ours: .hooks = [(.hooks // [])[] | select((.command // "") | contains($d) | not)];
  .hooks //= {} |
  .hooks.SessionStart = ([(.hooks.SessionStart // [])[] | strip_ours | select((.hooks | length) > 0)] + [{
    matcher: "startup|resume|clear|compact",
    hooks: [{type:"command", command:($d + "/session-start.sh")}]
  }]) |
  .hooks.UserPromptSubmit = ([(.hooks.UserPromptSubmit // [])[] | strip_ours | select((.hooks | length) > 0)] + [{
    hooks: [{type:"command", command:($d + "/drift-check.sh")}]
  }]) |
  .hooks.Stop = ([(.hooks.Stop // [])[] | strip_ours | select((.hooks | length) > 0)] + [{
    hooks: [{type:"command", command:($d + "/wrap-up.sh")}]
  }])
' "$SETTINGS" > "$SETTINGS.tmp" && mv "$SETTINGS.tmp" "$SETTINGS"

jq -e . "$SETTINGS" >/dev/null || { echo "❌ 配置写坏了，从 .bak-* 还原"; exit 1; }

echo "③ 说人话的全局规则 → $HOME/.claude/CLAUDE.md"
if [ -f "$HOME/.claude/CLAUDE.md" ]; then
  echo "   已存在，不覆盖。要对照就看 $SRC/global-CLAUDE.md.template"
else
  cp "$SRC/global-CLAUDE.md.template" "$HOME/.claude/CLAUDE.md"
  echo "   装好了"
fi

echo
echo "④ 自检"
printf '{"cwd":"%s","source":"startup","session_id":"install-check"}' "$PWD" \
  | "$DST/session-start.sh" | jq -e '.hookSpecificOutput.additionalContext' >/dev/null \
  && echo "   ✅ 报到脚本能跑" || { echo "   ❌ 报到脚本跑不起来"; exit 1; }
rm -f "$DST/locks/install-check."*

echo
echo "装完了。开一个新窗口，第一句话之后就会看到报到卡。"
