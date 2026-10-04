---
id: 2026-10-05-remotion-r1-template-spike
title: Remotion 通用视频模板（R1）：换客户只换参数，已用两套内容各渲一条
status: decided
owner: agent
decided_on: 2026-10-05
source: doc:docs/audits/2026-10-05-remotion-r1-template-spike.md
verify_by: 2026-10-12
verify_how: PM 合并后，进 R2（出片机接线）前在该目录跑 npm ci && npm test 全绿；并确认主站 type-check 与 npm test 没有因它新增错误。
---
独立目录 scripts/factory-worker/engines/remotion/，不接任何运行中的流程。细节、试跑证据、已知限制都在上面 doc 里。
