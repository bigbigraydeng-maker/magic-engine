---
id: 2026-11-05-daily-list-clear-exclusion-ui
title: 每日清单剔除过的 Reel 目前只能靠出新版本回来，缺「撤销剔除」的界面
status: decided
owner: agent
decided_on: 2026-11-05
source: pr:3617
verify_by: 2026-11-19
verify_how: 查 content_work_orders 里 brief.weekly_pack.excluded_by_card 非空的条数；有 PM 说「剔错了要放回去」的时候还没有界面 = 本卡该开工；两周内一条剔除都没有就延后
---
第 2 刀把剔除做成单向：删发布日、打标记、两条排期路径都拒绝。要放回去只能在工厂里出新版本。按 §11：频率 低 · IMPACT 中 · 收入 低 → P3。
