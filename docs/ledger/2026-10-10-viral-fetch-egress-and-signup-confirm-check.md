---
id: 2026-10-10-viral-fetch-egress-and-signup-confirm-check
title: 两个遗留风险：下载工具跟跳转进内网；确认 Supabase 注册是否强制邮件确认
status: decided
owner: pm
decided_on: 2026-10-10
source: session:34af475f
verify_by: 2026-10-17
verify_how: 一，给下载工具加受控出口或网络层禁内网和云元数据地址；二，在 Supabase 后台确认注册需邮件确认，否则任何人可用公司域名邮箱直接拿到管理员身份
---
来自 PR 2432 的狄仁杰审查。一的前提是攻击者已能写入网址（目前仅全局管理员），中危；二取决于线上后台设置，代码里看不到，若未开则为高危。
