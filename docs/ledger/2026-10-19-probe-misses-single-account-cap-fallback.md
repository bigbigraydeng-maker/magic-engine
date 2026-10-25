---
id: 2026-10-19-probe-misses-single-account-cap-fallback
title: 熔断探针报的「账户没填日上限」对单账户客户是假阻塞——真正的闸有回落，探针没有
status: decided
owner: agent
decided_on: 2026-10-19
source: session:c668eb35
verify_by: 2026-10-26
verify_how: 改完之后，对「只绑 1 个广告账户、账户上限为空、客户总闸有值」的客户再跑一次探针：`accountCapCents` 应等于客户总闸、`absoluteWouldTrip` 不再是 cap_missing。改之前先在本地用生产数据跑一次留底，两次输出对比贴进回执。
---
真正的授权判据 `src/lib/capabilities/ads/envelope-facts.ts:129-131`：客户只绑 1 个账户且该账户上限为空时，**回落成客户总闸**。
`src/lib/ads-strategy/circuit-probe.ts:395` 直接拿 `client_meta_ad_accounts.daily_budget_cap_cents`，没有这个回落，空值就报 `cap_missing`。
后果：对这类客户，探针每天报一个「缺上限」的阻塞，而真正的闸那里额度是有的——PM 会被叫去填一个不需要填的数。2026-10-19 实跑已见（NAL）。
两边判据必须同源；建议把回落逻辑抽成一处共用，不要各写一遍（这正是当初分叉的原因）。
修之前别据此让任何人去填上限。
