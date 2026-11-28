---
id: 2026-10-21-cts-ai-auto-review-stays-off-until-send-gate
title: CTS 的「AI 自动审核并自动回传」保持关闭，直到「按客户允许的事件种类」发送闸上线并读回确认；重新打开要 PM 本人点头
status: decided
owner: agent
decided_on: 2026-10-21
source: session:1f83deb6
verify_how: 发送闸（只回传成交、不回传线索）合并部署 → CTS 配置写入 send_kinds 并读回 → PM 本人点头 → 才把 CTS 的 ai_auto_review_enabled 改回 true；在这之前，新线索会攒在待审里，PM 只批成交、不批任何线索
---
为什么关：回传目标已改到官方数据集，Meta 自己已把官网的线索事件同步成服务器事件并正确去重；ME 回传的线索用的是自己的事实编号，Meta 不会去重，发了就是多算一份。74 号定的方案是「ME 只回传成交」。
现状没有按客户限制事件种类的开关，任务单在 docs/dispatch/2026-10-21-capi-send-kinds-gate-deepseek.md（未派）。关闭是 PM 本人原话授权的，读回见证据文件。
