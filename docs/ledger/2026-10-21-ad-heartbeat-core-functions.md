---
id: 2026-10-21-ad-heartbeat-core-functions
title: 广告心跳第①块：纯判断函数（零消耗/超限/状态变化/去重键/限条数/读失败分类），无读取、无迁移、无定时
status: decided
owner: agent
decided_on: 2026-10-21
source: pr:3028
verify_by: 2026-10-28
verify_how: 设计（PR 3027）过审后再进下一块（读取+定时函数+迁移）。本块只有纯函数与测试，合并后全仓行为不变。
---
A 级草稿 PR，PM 2026-10-21 回「开始」；纯函数，不碰 Meta、数据库、内核、定时。
