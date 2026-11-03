---
id: 2026-11-04-fix-admit-finished-resolve-ids
title: "修复：admit-finished 自动查目标和底稿 ID"
status: done
owner: agent
decided_on: 2026-11-04
source: session:90a50c3b
risk: C
verify_how: "部署后调 admit-finished 接口不传 goal_id 和 master_brief_id，确认自动查到并成功建工单"
done_on: 2026-11-04
done_ref: pr:3580
---

admit-finished 接口试跑时发现 goal_id 和 master_brief_id 是数据库必填字段，
但代码在不传时直接传 null 导致 500 错误。
修复：不传时自动从数据库查客户当前的活跃目标和底稿。
