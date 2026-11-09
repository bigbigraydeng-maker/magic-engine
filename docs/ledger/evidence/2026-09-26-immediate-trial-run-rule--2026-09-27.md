# 证据 · 2026-09-26-immediate-trial-run-rule · 2026-09-27
fetched_at: 2026-09-27T13:20:20+13:00
查了什么：①主干 CLAUDE.md 有没有「当场试跑」这一条；②主干合并闸（#2078 已合，main 5be460f1）在真实 PR 上对「改了定时 / 后台任务路径却缺「## 当场试跑」段」的 PR 是否拦下、不许自动合。
数字（带样本量、两边取数状态）：
- ①main 5be460f1 的 CLAUDE.md 含「当场试跑」1 处（取数成功）。
- ②非草稿探测 PR 3 个（都只改 src/lib/inngest/functions/ai-visibility-weekly.ts 一行注释，B 级；都带一张故意不合规台账卡，保证合不进）：#2106 正文没有试跑段 → Risk gate 红、自动合并关闭；#2107 先缺段 → 红（run 36282053555），只改正文补段后 edited 自动重跑 → 绿（run 36282121323）；#2108 走「当场跑不了」出口 + 新增 verify_by 2026-09-28 的卡 → 绿。3/3 符合预期（取数成功，来源 github-actions[bot] 的判级评论与 gh run list）。
来源/命令：git show origin/main:CLAUDE.md | grep -c 当场试跑；gh pr checks 2106/2107/2108；gh run list --workflow pr-risk-gate.yml --branch feat/probe-2078-edited；结果评论见 PR #2078。
结论：成——文字规则在主干，缺段的定时任务 PR 真被拦住不能自动合。
