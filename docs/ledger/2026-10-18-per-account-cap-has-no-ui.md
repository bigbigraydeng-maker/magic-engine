---
id: 2026-10-18-per-account-cap-has-no-ui
title: 每个广告账户的日上限只有接口、没有界面，违反「要填的字段必须连 Settings UI 一起做完」那条红线（C 级，待认领）
status: decided
owner: agent
decided_on: 2026-10-18
source: session:c668eb35
verify_by: 2026-11-18
verify_how: grep 后台页面有没有任何地方调 PATCH /api/clients/[id]/ad-accounts/[accountId]/daily-cap；今天基线是全仓为空。补完应能在界面上改每个账户的日上限，且保存时校验各账户上限合计不超客户总上限
---
客户级总上限有界面（广告健康页「目标与设置」），但每账户的上限只有那个要全局管理员身份的 PATCH 接口，没有任何界面调它。
WP3.1b 原计划里列了这一项（ad-accounts 页加一张两列输入表）并派给 DeepSeek，没做。
10/22 不急：PM 已定只走官方账户，它在 ME 内的上限 NZ$110 装得下日投 101，用不着改。
真要用个人账户、或哪天要分账户调额，就会卡在这里——现在只能让有管理员身份的人手打接口。
