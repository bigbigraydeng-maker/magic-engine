---
id: 2026-10-31-capi-health-empty-pipe
title: 正式回传且近 7 天有线索但成功回传为 0 时，健康检查显示黄灯
status: decided
owner: agent
decided_on: 2026-10-31
source: doc:docs/specs/2026-10-19-ads-tracking-preflight-workflow.md
verify_how: 单测里正式阶段、有线索、成功回传 0 为黄且原文是管道通但没料；无线索或已有成功回传仍绿；探活失败仍红
---
只改转化回传健康检查的显示。不改回传发送，不加表。
