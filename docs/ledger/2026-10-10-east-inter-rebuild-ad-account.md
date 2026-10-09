---
id: 2026-10-10-east-inter-rebuild-ad-account
title: East Inter 原定重建广告户，后改为重新启用澳币户并把绑定切过去（根因已更正）
status: decided
owner: agent
decided_on: 2026-10-10
source: session:ffe11a13
verify_by: 2026-10-15
verify_how: 澳币户状态为正常且付款方式已挂卡；系统里 East Inter 的绑定已指向澳币户；投出第一条广告后看红字限制提示是否消失。三项都成才算成。
---
更正（2026-10-10）：之前写的根因「纽币户国家字段为空导致加卡失败」不成立。横向比对商务账户：没绑过卡的户国家都是空，绑过的才有值，国家是绑卡后才填上的结果。加卡失败的真实原因没查清。
原计划重建新户：建户时被 Meta 拦下，「广告账户数量已达上限」，没建成。改为在后台把澳币户重新启用成功，卡已挂上；时区仍是苏黎世且改不掉。
未完成：把系统里 East Inter 的绑定从旧纽币户切到澳币户，需在后台设置里手动点，等 PM 操作。
背景见 doc:docs/clients/east-inter/2026-10-10-ad-account-payment-readiness.md
