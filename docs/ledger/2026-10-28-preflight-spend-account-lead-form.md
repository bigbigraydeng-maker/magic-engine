---
id: 2026-10-28-preflight-spend-account-lead-form
title: 开投前检查改看真正花钱的账户，表单留资广告不再要官网表单线索
status: done
owner: agent
decided_on: 2026-10-28
source: session:90a50c3b
verify_by: 2026-10-31
verify_how: 本 PR 合并部署后，触发一次开投前检查（或等每日那次），读 CTS 最新回执：「广告账户与付款」应为绿，摘要里在投合计是旧账户的 80.00 NZD；「官网线索进 CRM」应标「不适用」；广告审批页上组 C 的「确认」按钮应可点。三条任一不成立，说明配置没生效。
done_on: 2026-10-28
done_ref: pr:3336
---
CTS 组 C 被两道开投前检查锁住：检查读的是没有在投广告的官方账户，又只认官网表单线索。
新增可选配置 spend_ad_account_id，账户与预算那道门只读它；本期广告都是 Meta 表单留资，官网表单那道门标不适用。
下一次投点进官网落地页的广告前，必须把 web_form_to_crm 改回 true。
