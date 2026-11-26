---
id: 2026-11-16-crm-ai-pickup-release-page
title: CRM 跟进分工第二张单：「交给 AI」名单页，每天列出打了没接通 / 询价 7 天没人打的客人（一天最多 30 位，等得最久的先），看一眼勾掉不该发的，点一次整批发 2027 目录，发出确认后才挂 AI 跟进中
status: decided
owner: agent
decided_on: 2026-11-17
source: session:96dc6edf
verify_by: 2026-11-19
verify_how: 合并上线后用 PM 账号打开 CRM 顶部「交给 AI」，名单在 30 秒内出来、今天能发的不超过 30 位、每位写着原因和发到哪个邮箱；真点发送之后，crm_email_send_receipts 里有对应 catalogue-send 的 sent 记录、contact_automation_events 里每位一条 ai_takeover_on、这些客人从「今天先联系」消失
---
PM 11-16 回「开始」。做法比第一张单原计划更稳：不先打标记，点发送那一刻每位客人走现有「发送 2027 目录」那条路（全部发信检查照跑），发出确认后才挂 AI 跟进中；没人点之前客人一直留在员工名单上，所以每天早上的 crm-ai-pickup 不用打开写入开关。
当天已经联系过的（任何外发：电话、邮件、消息）顺延到明天；今天名额满的排到后面几天。11-17 生产库只读：150 位候选，今天 30 位可发、120 位排后，0 位发不了，名单生成约 22 秒。
页面过了 Impeccable：页面本身 0 条；剩全站 Inter 字体和全局回弹动画两类，不是本页引入。
