---
id: 2026-09-28-autofix-risk-gate
title: 自动修复机器人推代码前先查风险级别——A 级不推送，B/C 推送后留改动记录评论
status: decided
owner: agent
decided_on: 2026-09-28
source: session:d973200f
verify_by: 2026-10-05
verify_how: 让一个 A 级 PR 触发 Codex 审查→机器人不推送、只留中文评论；再让一个 B/C 级 PR 触发→机器人正常推送并留改动文件+审查链接评论。两个场景各观察一次即可。
---
自动修复机器人（ops-codex-to-claude-fix.yml）以前不看风险级别，A 级改动也照推。
现在 handle-review.mjs 在派活前调 classifyRisk + readDeclaredRisk 算风险级别：A 级或算不出来→只留评论、不推代码；B/C→正常推送，推完 mark-fix-outcome 留改动文件清单、审查链接和风险级别。
12 条新测试全绿（含 #2131 / #2115 真实场景复刻）。
