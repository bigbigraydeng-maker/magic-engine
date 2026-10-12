# 证据 · 2026-09-24-claimed-gates-missing · 2026-10-12
fetched_at: 2026-10-12T22:30:00+13:00
查了什么：记忆里"已装好"的两个闸现在是真有，还是记忆已改成"未安装"。
数字：ls ~/.claude/skills/grilling → No such file（技能确实不存在）；grep "gh pr merge" ~/.claude/settings.json → 0 命中（没有放行）；settings.local.json 不存在。记忆文件 feedback-grill-before-building.md 描述首句与第 22 行已明写"截至 2026-09-25 未安装"。
来源/命令：ls -d ~/.claude/skills/grilling；grep -n "gh pr merge" ~/.claude/settings.json；grep -n 未安装 memory/feedback-grill-before-building.md
结论：成——判据第二半（记忆文件已改为"未安装"）满足，且 settings 没有放行 gh pr merge，记忆不再说假话。
