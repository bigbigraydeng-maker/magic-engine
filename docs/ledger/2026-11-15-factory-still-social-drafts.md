---
id: 2026-11-15-factory-still-social-drafts
title: 社媒图片只准用工厂静图成片，花费开关默认关
status: done
owner: agent
decided_on: 2026-11-15
done_on: 2026-11-15
done_ref: doc:src/lib/factory/still-produce.ts
source: doc:src/lib/factory/still-produce.ts
verify_by: 2026-11-22
verify_how: 下一次写库模式回执在开关关上时静图为 0 且写明没开、账本没有新静图花费；打开开关并设正数帽后，回执有静图条数、账本有负数、Story 周包未授权。同一周再跑不重复。
---

社媒 Story 和图文只准用工厂静图成片。没有成片就跳过，不退回原图。
开关和每周花费帽写在 publishing_calendar_config.factory_stills，默认关。一张工单出这一周的静图，每张记一笔花费。
Story 周包只建草稿，不授权、不发送。
当场写库跑不了：会给真实客户写草稿，开关打开后还会花钱。
