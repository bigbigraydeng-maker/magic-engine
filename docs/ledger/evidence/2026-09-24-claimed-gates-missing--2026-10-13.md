# 证据 · 2026-09-24-claimed-gates-missing · 2026-10-13

fetched_at: 2026-10-13T23:05:28+1300

查了什么：verify_how 是「或」条件——①盘问技能装好且 settings 没放行合并命令，**或**②对应记忆文件已改成「未安装」。本晚两条分支都实查。

数字（带样本量、两边取数状态）：
- `ls ~/.claude/skills/grilling` → No such file or directory；`ls ~/.claude/skills/` 只有 2 项（client-invoicing、synced）。分支①前半不成立。
- 项目 `.claude/settings.local.json` 第 26 行仍有 `"Bash(gh pr *)"`（含合并），`~/.claude/settings.json` 无任何 gh pr 规则。分支①后半同样不成立——合并这一步目前确实没有机械拦截。
- 记忆文件 `feedback-grill-before-building.md` 的 description 与正文均已写明「盘问技能和合并拦截截至 2026-09-25 都未安装」，并反向指回本卡。分支②成立。

来源/命令：`ls ~/.claude/skills/grilling`；`ls ~/.claude/skills/`；`grep -rn "gh pr" ~/.claude/settings.json <repo>/.claude/settings.local.json`；`sed -n '1,30p' ~/.claude/projects/-Users-raydeng-Projects-magic-engine/memory/feedback-grill-before-building.md`

结论：成——「或」的第二条分支满足：两个闸确实没装，而记忆已经改成了「未安装」，不再有「说装好了其实没装」的假状态。注意这不等于闸装好了。
