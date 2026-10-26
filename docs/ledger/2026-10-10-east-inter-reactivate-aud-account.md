---
id: 2026-10-10-east-inter-reactivate-aud-account
title: East Inter 重建广告户没建成，改为重新启用澳币户；系统里的绑定还没从纽币户切过去
status: decided
owner: pm
decided_on: 2026-10-10
source: pr:2410
verify_by: 2026-10-15
verify_how: 澳币户状态为正常且付款方式已挂卡；系统里 East Inter 的绑定已指向澳币户；投出第一条广告后看红字限制提示是否消失。三项都成才算成。
---
建新户被平台拦下「广告账户数量已达上限」，没建成；改在后台重新启用澳币户，已启用、卡已挂上，但时区仍是苏黎世且改不掉。
旧的「废户重建」那张卡的根因说法不成立，由另一个 PR 把它标为 failed；这张卡不改它。
未完成：把系统里的绑定从旧纽币户切到澳币户，入口被权限拦住，等 PM 手动点。
背景见 doc:docs/clients/east-inter/2026-10-10-ad-account-payment-readiness.md
