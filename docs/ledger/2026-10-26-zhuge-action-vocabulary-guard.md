---
id: 2026-10-26-zhuge-action-vocabulary-guard
title: 诸葛亮直产 action 过封闭词汇表，不认识的 slug 不进执行看板
status: done
owner: agent
decided_on: 2026-10-26
source: session:9c08a71c
verify_by: 2026-11-02
verify_how: 合并后看一周生产日志里 `[action-persister] 丢弃 ... 个未登记的 action_type` 的条数——有即证明守卫在工作、同时能看到 LLM 临场编了哪些 slug 该补进 flywheel/kernel 词汇表；再核对 execution_items 新增的 source='zhuge' 行里，action_type 全部在 knownActionTypes() 返回集合内。
done_on: 2026-10-26
done_ref: pr:3173
---
Grok Bot #3075-主 等价（Grok 原 PR 已关，关 PR 决策见 2026-10-26-close-grok-cron-prs-rewrite-on-current-main）。
问题：writeExecutionItems() 直接把 Zhuge LLM top_actions 的 action_type 写进 execution_items，没过白名单；LLM 临场编的 slug（`launch_google_search_ads_3pl` 之类）进看板后 auto-run 跳过永不收口。
修法：新 src/lib/zhuge/action-vocabulary.ts，权威源是 @/lib/flywheel/vocabulary 四个 flywheel action 常量 + @/lib/kernel/registry 的 ACTION_REGISTRY，不维护硬编码白名单。writeExecutionItems 在 dedup 前过滤未知项、log WARN、返回 rejected_unknown_action_type 计数。严格字面匹配：不 trim 不 case-fold 避免看板同一动作两行。只作用于 Zhuge 直产通道，SEO weekly list/patrol/FDE/Luban 各有自己入口不走这里。
