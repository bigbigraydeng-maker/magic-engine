---
id: 2026-11-16-crm-ai-pickup-rules-slice1
title: CRM 跟进分工第一张单：每天判出「打了没接通」「询价 7 天没人打」的客人交给 AI（先只判不打标记）；客人回拨（接没接到）、回信、发消息就转回员工；停线挂到 Render 调度器每天跑
status: decided
owner: agent
decided_on: 2026-11-16
source: session:96dc6edf
verify_by: 2026-11-18
verify_how: 合并上线后，11-17 或 11-18 早上 cron_run_logs 里 crm-followup-stopline 有一条 summary.runner=dispatcher 的 completed；手动带 dry_run=1 跑 /api/cron/crm-ai-pickup（或设好名单后看运行记录）能看到 picked 名单，人数与 11-16 只读试判（约 151 位）同一量级；contact_automation_events 里没有 actor=system:ai-pickup 的行（开关没开）
---
PM 11-16 定规则：打过没真接通的一律 AI 接走；完全没打过超过 7 天的也接走；客人回邮件 / WhatsApp / 回拨就转人工。设计稿 docs/specs/2026-11-16-crm-ai-staff-followup-split-v0.md §12。
加的限制（不改 PM 规则方向，只防误判）：7 天没人打只认还在「新线索」、电话接进系统之后进来的；已报价及以后、员工亲自发过邮件、以前处理过一次的都留员工；一天最多接走 30 位。
11-16 只读试判：150 位（没接通 38、7 天没人打 112），抽 10 位核对都对。打标记开关默认关，等第二张单（目录名单 + 一次放行）上线一起开。
