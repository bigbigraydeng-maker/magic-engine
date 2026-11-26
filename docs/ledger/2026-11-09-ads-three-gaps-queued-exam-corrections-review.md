---
id: 2026-11-09-ads-three-gaps-queued-exam-corrections-review
title: 广告 agent 三个没排的缺口排进路线图：统一考卷 → 纠正记录 → 独立复核，三项都是 P2，第一项可先开，每项开工前仍要 PM 回「做」
status: decided
owner: agent
decided_on: 2026-11-09
source: session:c3bf7418
verify_by: 2026-11-18
verify_how: 11-18 看第一项「统一考卷」有没有给 PM 讲清并拿到「做」或「不做」；讲清前先只读查近 30 天广告判断规则改了几次、PM 纠正了几次，证明频率分仍是「中」；没讲清 → 当天补讲，不顺延
---
PM 11-09 回「现在就排」。来源：广告 agent 分工设计对照 docs/specs/2026-11-06-ads-loop-cangjingge-gap-baseline.md 第 5、7、8 问。排序与 §11 打分写在 docs/ROADMAP.md 顶部同名一节。
生产只读（11-09）：近 30 天 ads.create_ad 草稿 13 条、ads.auto_pause_on_d3 建议 3 条、内核真执行 ads.pause_campaign 2 次。
分工：考卷题目内容由 Grok 广告 Agent 出（它 11-09 提议合一套），纠正记录按 Grok 分工归 Traning Day 统筹；代码各由一个 Claude Code 窗口写，避免两边改同一文件。
