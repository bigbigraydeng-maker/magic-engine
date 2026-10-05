---
id: 2026-10-05-messenger-referral-attribution-fix
title: 私信广告来源归因修复：接住消息里带的来源和单独送来的来源事件，写进已有的来源一栏
status: decided
owner: pm
decided_on: 2026-10-05
source: session:1371db1a
verify_by: 2026-10-12
verify_how: PM 在 Meta 开发者后台给 Magic Engine 应用勾上 messaging_referrals 且本修复合并后，新的广告私信对话的来源一栏开始有值（查一次近 7 天有来源的对话数，大于 0 算成）
---
改动在私信入口（A 级，草稿，等 PM 回「合」）；不新建表、不加迁移。只记第一次来源、不覆盖，没有对应对话时不建空对话。
Meta 那边是否已订阅来源事件没验证；订阅是 PM 要点的一步，见改动单说明。
