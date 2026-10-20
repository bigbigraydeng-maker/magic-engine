---
id: 2026-10-21-content-gate-pr3a-server-recompute
title: 内容实质闸第三步之一（服务端）：交付时服务端用工单自己的参数重算「有没有实际内容」，默认只告警留审计，开关打开后缺内容就拒收
status: decided
owner: agent
decided_on: 2026-10-21
source: pr:3015
verify_by: 2026-10-28
verify_how: 合并部署后（翻开关前提醒：出片机回执缺 capability 的工单会因 content_substance_missing 进死信且不可自动重试——先确认没有旧版出片机在跑）：①读生产库新交付的 remotion 工单 output.content_substance，server.verdict 与 reported.verdict 一致（mismatch=false）、capable=true；②翻开关 FACTORY_CONTENT_SUBSTANCE_ENFORCE=1 的前提：出片机回执 capabilities 读回 content_substance_v1（已于 10-21 随 PR 3015 升级）且没有旧回执在飞；翻完后用氛围片 17419d99 的真实 props 提一张测试单，必须在出片机侧被拦，服务端对同 props 复核也判 fail；③第三步之二（审片页「素材」分区 + 「单独发给粉丝能看懂吗」V3 清单项）另开。
---
服务端 TS 孪生 src/lib/factory/content-substance.ts 与引擎版逐字段一致，由 content-substance.parity.test.mjs 对拍（13 个夹具）。complete-work-order.ts 在任何库写入之前计算；output.content_substance 记 server/reported/capable/mismatch/enforced；标 asset_only 的记 output.deliverable。开关 FACTORY_CONTENT_SUBSTANCE_ENFORCE 默认关（只告警）。capabilities 只用来检测旧版本出片机（不防伪造：真正挡内容的是服务端重算）；畸形 brief.remotion（engine=remotion 却缺/坏）开关打开后判 fail 而不是跳过。翻开关前要先清空在飞的老单。翻开关需 Render 改环境变量并手动重新部署（改变量不会自动部署）。
