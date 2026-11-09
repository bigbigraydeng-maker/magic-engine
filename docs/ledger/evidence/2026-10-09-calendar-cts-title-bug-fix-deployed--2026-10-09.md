# 证据：2026-10-09-calendar-cts-title-bug-fix-deployed · 取数 2026-10-09（NZ 时间，日历巡检只读核实）

日历事件：看一下 CTS 自动改标题的漏洞修好上线没有；没上线就回孔子「关」

## 结论

#1948 已于 2026-09-26 14:12Z 合并，位于 origin/main 祖先链上，main 最新部署（dd3692a8，2026-10-08）状态 success；9/28 周一那轮已在修复后跑过（样本 1 轮），不需要关开关。

## 怎么查的

gh pr view 1948: MERGED 2026-09-26T14:12:34Z; git merge-base --is-ancestor b80d2954f origin/main = yes; gh api deployments 最新 sha=dd3692a8 status=success; CTS seo_config.meta_cycle_enabled 当前仍 true（符合 PM 9/26 决定保持开着）。
