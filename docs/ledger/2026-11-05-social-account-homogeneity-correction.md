---
id: 2026-11-05-social-account-homogeneity-correction
title: PM 指出 CTS 账号内容同质化（视觉、剪辑、BGM）——社媒 Agent 加账号自检环，这次纠正落成检查项、考题和规则 SO-13
status: decided
owner: agent
decided_on: 2026-11-05
source: doc:docs/specs/2026-11-05-social-agent-account-self-check-loop-v0.1.md
verify_by: 2026-11-12
verify_how: 开发计划第 2.5 刀的 2.5a 合并：src/lib/social/account-audit 存在、考卷第 1 题（CTS 2026-11-05 的 41 条快照）期望命中模板集中度、BGM 重复、改版扎堆、形式覆盖四项并通过；cron_run_logs 有 social-account-audit 回执；没合并就看卡是不是在等 PM 回「做」
---
PM 2026-11-05 以 CTS Facebook 社媒总负责人视角说同质化太严重，要求先把社媒 Agent 改成今后能用 agent loop 自己闭环修复，再出方案。实查近 60 天 41 条：2 个模板（明信片 27、清单 14）、4 首曲子占 80%、真人 / 客人 / 干货 0 条、大量广告测试改版进了账号。按藏经阁第十部，这次纠正三处都落：自检检查项 D1–D6、考卷第 1 题、规则表 SO-13（候选）。行业层结论只有 CTS 一个证据，留候选。
