---
id: 2026-10-21-ads-launch-step-has-no-daily-cap-check
title: 真正把广告打开的那一步（草案批准、恢复暂停系列）没有日预算上限检查，要补一道：在投合计 + 这条的日预算超过上限就拒绝开
status: decided
owner: agent
decided_on: 2026-10-21
source: pr:2992
verify_by: 2026-11-04
verify_how: 两个开投入口（src/lib/ads-strategy/draft-and-gate.ts 的 approveDraft、meta-ads/execute 的 ads.reactivate_campaign）里各有一道日预算上限检查：读账户当前在投合计，加上这条的日预算，超过库里的账户级 / 客户级上限就拒绝开并留回执，读不到也拒绝；有对应测试（超限拒、读不到拒、没超放行）；用不真开的草案在沙盘上当场试一次。三项都做到 = 成；没动手就把 verify_by 顺延并写原因。
---
魏征审 #2992 时问「预算门之外，真正开投那一步有没有兜底」：读代码核对是没有（事实见 2026-10-21-ads-plan-budget-gate-include-live）。预算门只在计划批准前核一次，而计划批准后可以隔很多天才开，期间账户里的在投预算会变；Meta 工具 / 广告后台手建的广告更是完全不经过 ME，这条管不到。
要做：在两个开投入口各加一道上限检查（复用预算门的读取器 src/lib/ads-tracking-preflight/budget-reader.ts，别另写一套口径），读不到就不开。这是花钱的闸，按 A 级处理：要出设计、两审、PM 本人同意；归广告总控线（119 / 74），不在预算门这个 PR 里。
