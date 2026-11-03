---
id: 2026-11-04-fix-admit-finished-order-type
title: "修复：admit-finished 工单类型字段值不在数据库允许范围"
status: done
owner: agent
decided_on: 2026-11-04
source: session:90a50c3b
risk: C
verify_how: "部署后调 admit-finished 接口，确认工单成功写入数据库不再报 order_type 约束错误"
done_on: 2026-11-04
done_ref: pr:3581
---

admit-finished 接口试跑时写入 `order_type: 'reel'`，但数据库只允许
`variant_from_winner` / `fresh_angle` / `clip_generation` 三个值，导致写入失败。
改为 `fresh_angle`（上传外部成品视频语义上最接近"全新角度"）。
