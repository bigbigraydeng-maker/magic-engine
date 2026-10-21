---
id: 2026-10-21-ad-heartbeat-read-layer
title: 广告心跳第②块：只读读取层（精简字段 Graph 读取 + 读失败分类 + 账户时区当日 + 限流中止），无库、无定时、无写入
status: decided
owner: agent
decided_on: 2026-10-21
source: pr:3035
verify_by: 2026-10-28
verify_how: 合并后无行为变化（没有调用方）。当场试跑已做：对 CTS 官方账户只读一轮，4 次读、约 4.2 秒、3 个在投广告组读到花费/曝光、账户状态 1；下一块（迁移 ad_heartbeat_alarms + Inngest 定时，默认 dry）再接入。
---
B 级只读；设计见 docs/specs/2026-10-21-ad-heartbeat-design-v0.2.md。
