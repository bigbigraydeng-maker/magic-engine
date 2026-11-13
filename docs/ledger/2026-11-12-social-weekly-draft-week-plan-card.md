---
id: 2026-11-12-social-weekly-draft-week-plan-card
title: 每周出稿写库成功后自动出周计划确认卡并进今日待办
status: done
owner: agent
decided_on: 2026-11-12
done_on: 2026-11-12
done_ref: doc:src/lib/social/weekly-plan/after-draft.ts
source: doc:src/lib/inngest/functions/cloud-social-weekly-draft.ts
verify_by: 2026-11-19
verify_how: 写库模式每周出稿某客户跑通后，今日待办出现「本周包等你批」，总览里有一张待确认的周计划卡；同一客户同一周不重复出卡；出稿失败或建卡失败时出稿回执仍标完成，失败只记在运行摘要和日志。
---
不发布、不自动批准。复用 social_plans、action_runs、confirmation-card 内核和现有 pm-todo 拼装。叠在 #3804 失败收口之上。
