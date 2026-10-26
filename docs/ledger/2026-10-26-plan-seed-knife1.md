---
id: 2026-10-26-plan-seed-knife1
title: 处方→计划草稿第一刀：服务端用事实产出「账户+日预算」建议种子，处方审阅页与计划页可见（只读，不写计划、不建广告）
status: decided
owner: agent
decided_on: 2026-10-26
source: pr:3195
verify_by: 2026-11-02
verify_how: 合并部署后，在 ME 里打开 CTS 目标下的处方审阅页（或计划页的处方卡），应看到 Agent 建议的账户与日预算，每个字段带依据或留空原因，并有一句「这些数字只是 Agent 的建议，批准这份处方不等于批准花这些钱」与数据抓取时间那句话。用只读 SQL 对照：`ad_strategy_configs.daily_budget_cap_cents`（客户日上限）、`client_meta_ad_accounts.daily_budget_cap_cents`（各账户上限）、各账户在投合计，应与页面数字对得上。处方没有填「广告打法」时页面应说「这份处方没有填广告打法」。验收时数一次 marketing_plans 与 prescriptions 的行数和更新时间，只读接口前后不变。第二刀（受众/素材/排除名单）、第三刀（写入计划）另做。
---
A 级（碰预算数字的产出与处方写入口）。服务端构建并存 content.plan_seed，客户端/LLM 给的 plan_seed 一律丢；ad_plays 在 parseSeed 校验，形状错 422；manual/generate/refine 三处接线（永不抛错、8 秒上限）。设计稿 v0.6（见 PR 3193 / 分支 docs/prescription-to-plan-v06）。
