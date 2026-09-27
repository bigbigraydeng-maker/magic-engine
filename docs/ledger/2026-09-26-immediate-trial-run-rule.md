---
id: 2026-09-26-immediate-trial-run-rule
title: 新功能交付前必须当场试跑一次完整链路，跑通了才能说做好了、可以上线
status: done
owner: agent
decided_on: 2026-09-26
source: doc:CLAUDE.md
verify_by: 2026-10-03
verify_how: 主干 CLAUDE.md 含「当场试跑」条；合并检查已对定时 / 后台任务路径要求 PR 正文带「## 当场试跑」段——开一个改了定时任务路径却缺这一段的测试 PR，确认它不能自动合。两项都成立算成
done_on: 2026-09-27
done_ref: pr:2078
---
PM 2026-09-26：功能做完后常常 3 天或 1 周后第一次自动跑才发现失败。今后先当场用测试数据跑通，再报做好。
文字规则写进 CLAUDE.md「权限与验证证据」；机器拦截交合并闸窗口实现（`tools/ops-review-loop/src/quality.mjs` 里已有定时任务证据项，但至今没有检查调用它）。
