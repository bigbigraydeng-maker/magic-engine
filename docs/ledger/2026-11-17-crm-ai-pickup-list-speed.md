---
id: 2026-11-17-crm-ai-pickup-list-speed
title: 「交给 AI」名单页正式环境打开要 68 秒（本地 23 秒），离 100 秒超时太近；发信检查改成一次同时 8 位，本地降到约 6 秒
status: decided
owner: agent
decided_on: 2026-11-17
source: session:96dc6edf
verify_by: 2026-11-18
verify_how: 上线后用 PM 账号打开 CRM「交给 AI」，从打开到名单出来不超过 30 秒（浏览器 performance 里 /api/clients/<id>/crm/ai-pickup 的耗时），名单人数和顺序与改之前一致（今天 30 位可发）
---
11-17 上线后实测：名单接口 68 秒才回来，慢在逐位检查发信条件（每位要读十来次库）。改成按顺序每次同时检查最多 8 位，且不超过今天剩下的名额，等得最久的仍然先占名额。生产库只读重跑：结果不变（30 位可发、120 位排后），用时 5.7 秒。
