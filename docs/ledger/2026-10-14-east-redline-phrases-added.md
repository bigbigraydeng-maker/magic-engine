---
id: 2026-10-14-east-redline-phrases-added
title: East Inter 的禁用词已补上（倒计时、限时、最低价等 22 个）
status: done
owner: agent
decided_on: 2026-10-14
source: session:9cbc0338
verify_by: 2026-10-21
verify_how: 第一条 East 成片交审时，用含 countdown 的测试字幕确认审核页会标红；没标红就是词没生效
done_on: 2026-10-14
done_ref: doc:docs/clients/east-inter/2026-10-14-east-video-factory-wiring-plan.md
---
PM 回「补词」后，只对 East（client 2e3f040d…）把 `brand_redline_phrases` 从空补成 22 个词（英文 17 个：countdown / limited time / limited-time / ends soon / last chance / hurry / days left / weeks left / spots left / deadline / early bird / expires / cheapest / lowest price / lowest rate / best price / guaranteed lowest；中文：倒计时 / 限时 / 截止 / 最低价 / 最便宜）。只写了这一个客户，写前条件是该字段为空。读回确认 22 个。
