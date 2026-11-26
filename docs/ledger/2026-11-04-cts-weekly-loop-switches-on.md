---
id: 2026-11-04-cts-weekly-loop-switches-on
title: CTS 社媒每周闭环与周卡开关已打开（转公开开关保持关闭）
status: decided
owner: pm
decided_on: 2026-11-04
source: pr:3579
verify_by: 2026-11-05
verify_how: 2026-11-05 新西兰 08:30 后，cron_run_logs 有一条 social-weekly-draft 写库模式（mode=write）的 CTS 回执：maliang_backfill 有 reviewed、spent_usd ≤ 0.5；下周 3 条 Reel 的 brief.weekly_pack.publish_on 已写入；周卡出现在 PM 待办；带错字客人片 693d71da 不在候选里
---
PM 11-04 回「开」。已打开：CTS publishing_calendar_config.weekly_loop.enabled、Render SOCIAL_WEEKLY_LOOP_ENABLED / SOCIAL_WEEKLY_LOOP_WRITE / WEEKLY_PACK_APPROVAL_ENABLED（改后手动重新部署）。保持关闭：WEEKLY_PACK_REEL_GO_PUBLIC（打开后批卡那一刻会把整周 Reel 同时公开，不按日期分开，且代码注明须等 #2817）、FACTORY_PUBLISH_LIVE。带「Guillin」拼写错误的客人片旧版 693d71da 标为 superseded，等 v2。方案文档 docs/clients/cts/2026-11-04-cts-social-operating-plan.md。
