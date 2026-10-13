---
id: 2026-10-12-story-lite-minimal-build
title: Story 自动发布最小版（2 张表 + 授权 / 撤销 / 预览接口 + 每 10 分钟发布函数）：只演练，建表与真发都没批
status: decided
owner: pm
decided_on: 2026-10-12
source: session:61a3b5f4
verify_by: 2026-10-19
verify_how: 看最小版 PR 是否合并；看预览页 PR 是否已另开；建表、公开存储上传、真实 Meta 调用、真发开关每一项 PM 没另批就保持未做；到期时看 cloud-story-lite-publish 是否在 cron_run_logs 里每 10 分钟有记录（演练模式也有）
---
PM 10-12 回「最小版」：2 表、预览页（授权这一周 / 停）、授权 / 撤销接口、每 10 分钟定时函数，先只做 Facebook，授权 / 开关 / 待办照搬每日图文。
设计稿 docs/specs/2026-10-12-story-lite-design.md；建表 SQL 只写不执行：docs/migrations-sql/2026-10-12-story-lite-NOT-APPLIED.sql。
本机临时库端到端演练已跑通（假 Facebook），线上库没碰。
