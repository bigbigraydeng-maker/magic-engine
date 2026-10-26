---
id: 2026-10-25-wa-referral-utm-attribution
title: WhatsApp 广告来源和官网表单 UTM 写进 CRM 来源归因（代码草稿，未合并未上线）
status: done
owner: agent
decided_on: 2026-10-25
source: issue:3125
done_on: 2026-10-25
done_ref: commit:c6c089f
verify_by: 2026-11-01
verify_how: 合并上线后，看新进的 WhatsApp 广告会话联系人 attr_platform=meta、有 source_id 的带 attr_ad_id；带 utm 的官网表单通知触点 attr_platform=meta。历史 9 个会话由 Ray 自己跑 scripts/backfills/backfill-whatsapp-referral-attribution.ts（默认预演）。
---
改了 whatsapp webhook 路由、crm/attribution.ts、邮件表单解析（utm）；entry_referral 只读不改。官网表单要真带上 UTM，还需客户官网把 UTM 放进表单通知（代码外前提）。
回填脚本 --live 先写「运行开始」回执，写不进即中止、零数据库更新（backfill-receipt.ts）。
