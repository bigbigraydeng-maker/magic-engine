---
id: 2026-10-21-agent-ledger-w1b-first-real-observation
title: 广告智能体台账 W1b：第一条「观察到在投」的真实回执，要等广告与成片的关联行能写出可解析的行（今天库里一条都没有）
status: decided
owner: agent
decided_on: 2026-10-21
source: pr:2963
verify_by: 2026-11-04
verify_how: 生产库 ad_creative_links 里已有至少一条可解析的行（link_method 为 published_post_id 或 asset_binding，creative_ref 非空），并且台账（agent_request_receipts）里出现第一条真实的 observed_live 回执，provider_ref 带 link_method、link_strength 和 target。两项都做到 = 成；119 的补链 PR 还没落地就把 verify_by 顺延并写原因，不放宽台账的核验。
---
设计 v0.7 把 W1 验收拆成 W1a（从发出请求到成片被批准，不依赖关联表，先验）和 W1b（观察到在投到 T+7 对账，卡在 119 的补链）。
生产只读核对（10-21）：关联表全表 4 行、0 行解析成功，在投的广告一条关联行都没有，所以 W1b 的生产首条真实链路现在会「没过」——如实报，不凑，不放宽函数的核验。
首次真实对账（T+7）另开卡：等第一条 observed_live 回执出来后，按它的日期加 7 天开。
