---
id: 2026-10-19-d3-blocked-by-missing-target-cost
title: D3 天天判不了的真因是客户没填「一个结果目标花多少钱」，这是只有 PM 能定的业务数字
status: decided
owner: pm
decided_on: 2026-10-19
source: session:c668eb35
verify_by: 2026-10-26
verify_how: PM 给出数字后填进设置页「广告结果怎么算」，次日看 ad_health_narratives 里这个客户的 D3 还是不是 not_comparable；若变成 hit 或 healthy 即闭环。CTS 那边要等账户恢复投放有花费才谈。
---
实查 `ad_strategy_configs`：有一个 bounded_auto 客户填了主结果（开聊）但 `target_cost_per_primary` 是空的，所以 D3 每天只能回 `not_comparable`。
判据本身是对的，`d3-spend-no-result.ts:37-45` 明确拒绝用行业默认值顶替客户目标（红线 7），宁可说判不了。
另一个 bounded_auto 客户这两项都填了（主结果 lead、目标 $11），但账户近两周零花费，同样比不出来。
所以「自动暂停零记录」追到底是两件非技术的事：一个缺业务数字、一个账户停投。
填的地方：客户设置页「广告结果怎么算」，不需要开发。
