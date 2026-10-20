---
id: 2026-10-21-factory-api-scoped-admin-not-limited-to-own-client
title: 内容工厂的 4 个接口没把「限定单个客户的管理员」限定在他自己的客户里：能看别家客户的工单、批准 / 打回 / 改预算别家的成片、复活别家的死信工单、用聊天助手操作别家客户
status: decided
owner: agent
decided_on: 2026-10-21
source: session:1f83deb6
verify_by: 2026-11-04
verify_how: 读代码确认 /api/factory 下聊天、审核、复活、工单列表四个接口对限定客户的管理员（环境变量 DEMO_ADMINS）都限定在他自己的客户：别家客户的工单一律 403，工单列表只返回他自己客户的，全局管理员的行为不变，每个接口有逐条测试；或者 PM 明确决定不收紧，把原因写进卡里再改 failed。
---
统管 18 号 10-21 查生产：DEMO_ADMINS 没设，库里 2 个限定客户的演示账号不在管理员名单里，requireAdmin 对它们直接 403，所以现在没人走得到这些口子，是潜在口子（74 判 P2）。
我逐行核实：同一个根因在 4 处。聊天（/api/factory/chat，客户 id 来自请求体，工具能列别家待审工单、打回、改预算）· 审核（…/work-orders/[id]/review，批准 / 打回 / 改预算都没传客户 id，PR 3003 里有一张只管这一处的卡）· 复活（…/work-orders/[id]/revive，能把别家死信工单重新排产，会再花钱）· 工单列表（GET /api/factory/work-orders，返回所有客户最近 100 条，含客户名和成本）。工单提升接口已限全局管理员，不在内。
修法：一个共用的「客户范围」检查 + 逐条测试，放进同一个 A 级 PR（等 PR 3003 合并后从新主干开，一次签字）。本卡只记录，不改代码。
没逐个核实的：别的目录里只用 guardAdmin 的按客户接口（很多）是否同类，不在本卡范围。
