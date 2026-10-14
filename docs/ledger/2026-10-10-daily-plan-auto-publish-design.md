---
id: 2026-10-10-daily-plan-auto-publish-design
title: 审过的图文 Post 要能每天自动发到 Facebook（先出方案送审，PM 说「做」才写代码）
status: decided
owner: agent
decided_on: 2026-10-10
source: session:fd836f50
verify_by: 2026-10-17
verify_how: 7 天内应有结果：方案被两位审查看完并改完，PM 回「做」或「不做」；没动静就是卡住了，要提醒 PM
---
设计稿：docs/specs/2026-10-10-daily-plan-auto-publish-design.md（风险级别 A）。
范围只含 Facebook 图文 Post；Instagram 图文与 Story 本轮不做。
授权 = PM 点一次「通过并授权自动发布」，绑定计划版本，可随时撤；没授权永不发。
进度：第一刀（发布流程抽共用函数）已合并 pr:2423；第二刀（授权/撤销接口 + 两张表 + 撤回联动，不含界面、不含自动发布）开草稿 PR 中，建表须 PM 同意后才执行；第二刀已合并 pr:2430、表已建；第三刀 a（每小时发布器 + 待办 + 确认接口，默认只演练）已合并 pr:2435；第三刀 b（授权/撤销/确认的界面按钮）未开工；真发开关打开前的 10 项清单见 golive-prereqs 卡。
