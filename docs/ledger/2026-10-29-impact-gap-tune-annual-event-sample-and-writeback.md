---
id: 2026-10-29-impact-gap-tune-annual-event-sample-and-writeback
title: 事件促销场景缺口（学习段）：一年一次的事件样本太少，要靠去年数据起步并跨客户汇总，结果要真写回下一轮
status: decided
owner: agent
decided_on: 2026-10-29
source: doc:docs/specs/2026-10-29-impact-gap-three-layer-event-campaign.md
verify_by: 2026-12-17
verify_how: 查事件结果是否写进该客户私有记忆并改变下一次排序或动作；去年同期数据是否作为起点被读取；学习晋升是否遵守「同行业至少三家有证据才升行业层」；飞轮适配器是否真把广告结果写回计划，10/18 标为未验证，需重验。
---
平台层：学习写回下一轮排序、记录 inconclusive。行业层：跨客户汇总后才升级的行业经验（现在只有单样本）。企业层：本客户私有记忆、去年同期数据。
Tune 没有改变后续决策，就不能称为学习闭环。
