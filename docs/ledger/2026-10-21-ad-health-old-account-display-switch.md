---
id: 2026-10-21-ad-health-old-account-display-switch
title: 广告健康页加一个「是否展示」开关，旧个人账户关掉后不再冒出「状态异常」（PR 3012，数据那步等 PM 授权）
status: decided
owner: agent
decided_on: 2026-10-21
source: pr:3012
verify_by: 2026-10-28
verify_how: 要 PM 授权才执行：应用 10-21 那份展示开关迁移，再把 CTS 旧个人账户（标签「主账户」）的 hidden_from_ad_health 置 true；之后刷新 CTS 广告健康页，「今天调什么」里不应再出现旧个人账户的状态异常。没授权就不动，到期顺延。
---
只改展示：不碰投放、预算、内核。迁移和数据这一步都要 PM 本人点头。
本卡替换 PR 3012 带来的同日旧卡：旧卡把 14 位迁移版本号写进了判据，台账读不出，学习库页面因此报错。
