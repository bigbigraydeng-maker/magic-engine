---
id: 2026-11-01-social-readback-outcome-visible
title: 短视频被拒绝记成绩时，要在今日待办里看得见
status: done
owner: agent
decided_on: 2026-11-01
source: doc:docs/specs/2026-10-29-social-wp1-readback-implementation-brief-v2.md
verify_by: 2026-11-08
verify_how: 开关 SOCIAL_READBACK_OUTCOME_ENABLED 正好是 true 之后，一条仍是草稿或公开时间对不上的短视频拒绝，要在今日待办出现一条，并且运行记录里有一行任务名 social-readback-outcome、没有推广活动字段；开关没开时这个任务名不新增行。
done_on: 2026-11-01
done_ref: pr:3492
---
读回链拒绝以前只在函数里返回，今日待办看不见。本轮把拒绝写成已有运行记录，不新建表。
开关默认关。打开前生产不会多写。登记在不排班名单，不占定时表。
验的时候看今日待办那一条和运行记录，不要在生产重发已发出的信号。
