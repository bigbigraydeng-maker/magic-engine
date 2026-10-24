---
id: 2026-10-24-campaign-client-view
title: 客户看推广活动时不再看到内部备注和竞品调研
status: decided
owner: agent
decided_on: 2026-10-24
source: issue:3099
verify_by: 2026-11-01
verify_how: 用 both 或 dashboard、且不是内部名单的客户账号打开推广活动，描述里搜不到 PM 指令和竞品内容；内部账号仍看得到原文。不要查生产库。
---
活动描述和内部备注存在同一格。客户接口改为只返回点名过的字段，客户保存也不会把这格写成空。
没有拆新字段，所以客户暂时看不到这段描述。若以后要给客户单独一句公开说明，再加字段。
