---
id: 2026-10-19-cross-account-gate-measures-budget-not-spend
title: 跨账户日上限的运行时闸比的是「预算设置合计」不是「当日实际花费」，路线图说成完全没有闸是不准确的
status: decided
owner: agent
decided_on: 2026-10-19
source: session:c668eb35
verify_how: 设计稿 §5 第 1 条的实测先跑出来：用生产 ad_daily 算「当日实际花费 ÷ 当日在投预算设置」的分布，取实测上分位数当超投系数，不许抄 1.25。拿到数字再回头改设计稿、才谈动代码。
verify_by: 2026-10-26
---
实查 `src/lib/capabilities/ads/envelope-facts.ts`：第 128-138 行比各账户上限之和、第 250-251 行比单账户在投预算、第 256-259 行比跨账户在投预算合计，授权与下发前各查一次。
所以闸是有的，口径是预算设置。会与实际花费分开的三个原因：Meta 单日可超投、改预算不退已花的钱、判据只认 ABO 不认 CBO 系列预算。
卫青 2026-09-27 查实的那次合计超闸，是这个口径差造成的，不是没有闸。
设计稿：`docs/specs/2026-10-19-ads-cross-account-daily-spend-gate-v0.1.md`（A 级，只设计；建议先做不需要新数据的保守折算版）。
ROADMAP 那条「运行时没人查」的措辞要跟着改，但本窗口没顺手改它。
