---
id: 2026-10-21-ad-heartbeat-alarms-migration
title: 广告心跳第③块：新表 ad_heartbeat_alarms（状态行+报警行、去重键唯一、RLS 只给 service_role）——迁移文件，未应用
status: decided
owner: agent
decided_on: 2026-10-21
source: pr:3036
verify_by: 2026-10-28
verify_how: PM 另给原话后才应用迁移；应用后核对：表存在、匿名访客读写被拒、迁移末尾断言通过；之后心跳定时函数（默认只演练）才开始写状态行。
---
A 级草稿；设计见 docs/specs/2026-10-21-ad-heartbeat-design-v0.2.md §3/§9；单表（jsonb 存上次状态），7 天清理由心跳函数每轮顺手做。
