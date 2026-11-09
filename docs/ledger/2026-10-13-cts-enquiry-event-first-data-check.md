---
id: 2026-10-13-cts-enquiry-event-first-data-check
title: 查一下官网新事件有没有开始记询盘（团页/攻略页询盘口径第一次出数）
status: decided
owner: agent
decided_on: 2026-10-13
source: pr:2525
verify_by: 2026-10-21
verify_how: 官网改动 chinatravel#232（10-12 已合并）上线后第一个整周，核三件：①手动试跑 ga4-organic-landing-leads（dry_run，CTS）读回 enquiry_thank_you 大于 0；②让员工看一封真实询盘邮件，新增 4 行（First landing page 等）在；③无员工反映邮件读不了。成=三件都成；不成第一步=对 chinatravel#232 点 Revert 并开卡。
---
口径文档 docs/clients/cts/2026-10-13-cts-enquiry-definition-and-form-spec.md；母卡 2026-10-13-cts-enquiry-definition-form-and-organic-report。只读 GA4，不花钱。
