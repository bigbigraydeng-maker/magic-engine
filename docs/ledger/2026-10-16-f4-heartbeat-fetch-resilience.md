---
id: 2026-10-16-f4-heartbeat-fetch-resilience
title: 对话体检（F4 心跳）连续整批失败：改成错开整点、多重试、报错带出具体网络原因、整体加 90 秒超时；上线后要看到它重新跑成功并把真实告警写进告警表
status: decided
owner: agent
decided_on: 2026-10-16
source: session:96dc6edf
verify_by: 2026-10-18
verify_how: 合并部署后在 Inngest 后台看这个任务下一次 7 分触发是否成功；成功后告警表里应出现当前真实的静默渠道告警（本机预演有 6 项）；若仍失败，报错里会带具体错误码，据此再定下一步
---
原因：近 24 小时 4 次全部在第一步 run-checks 报「fetch failed」，本机同一份代码 1.5 秒成功，问题在线上网络那一跳，疑似整点任务扎堆。这是监控任务，不在客人回复链路上。
