---
id: 2026-11-04-social-weekly-loop-p6-orchestrator
title: 社媒每周闭环 P6：每周编排 cloud-social-weekly-draft（默认演练、开关关）
status: decided
owner: pm
decided_on: 2026-11-04
source: pr:3571
verify_by: 2026-11-18
verify_how: 合并部署后在 Inngest 后台 Sync，手动发一次 social/week_pack.draft_due（CTS，mode=dry_run），cron_run_logs 出一条 social-weekly-draft 回执：读到团目录、版本归组数、事实核对过/不过/待人核数、马良未审数、拟排期每周 3 条；线上工单 brief 与 output 无改动
---
设计 v1.1 §3 第 6 行：Inngest 函数 cloud-social-weekly-draft（每天新西兰 8:30 派发 + 事件 social/week_pack.draft_due 按客户运行），串起版本归组 → 事实核对 → 马良状态 → 四层方子 → 排期。开关 SOCIAL_WEEKLY_LOOP_ENABLED / SOCIAL_WEEKLY_LOOP_WRITE 默认关，客户配置 weekly_loop.enabled 也要开；手动演练事件开关关也能跑。不发布、不出卡、不写人工审片清单。A 级（新增定时函数），PM 本人回「合」才合。
