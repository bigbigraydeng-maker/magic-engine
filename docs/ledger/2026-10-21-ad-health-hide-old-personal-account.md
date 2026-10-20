---
id: 2026-10-21-ad-health-hide-old-personal-account
title: 广告健康页不再显示旧个人账户的「状态异常」，只围绕 CTStours 官方账户（加一个展示开关）
status: decided
owner: agent
decided_on: 2026-10-21
source: pr:3012
verify_by: 2026-10-28
verify_how: PM 授权后：应用迁移 20261021130000，把 CTS 旧个人账户（标签「主账户」）的 hidden_from_ad_health 置 true；刷新 CTS 广告健康页，「今天调什么」里不应再出现 Pengyu Deng 账户状态异常。
---
展示层改动，不改投放/预算/内核；迁移与那条数据步骤都等 PM 授权。
