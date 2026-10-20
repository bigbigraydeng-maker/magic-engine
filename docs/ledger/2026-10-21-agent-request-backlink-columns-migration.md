---
id: 2026-10-21-agent-request-backlink-columns-migration
title: 广告请求回执台账第 0 步迁移：给执行项和成片工单各加一个「挂在哪条广告请求上」的列，只能写一次（工单允许后继请求接手一次）；迁移只写文件，PM 点头后才 apply
status: decided
owner: agent
decided_on: 2026-10-21
source: session:1f83deb6
verify_by: 2026-11-04
verify_how: PM 点头并 apply 之后，读生产库核对：execution_items 有 agent_request_id，content_work_orders 有 agent_request_id 和 agent_request_prev_id（都是 uuid、可空）；四个触发器函数都在、search_path 配置为空串；content_work_orders 上三个触发器（只写一次 / 禁止删除已绑定的 / 插入守卫）和 execution_items 上一个都在且启用（pg_trigger.tgenabled = O）；两张表的属主就是将来台账函数的属主；两个部分索引都在。PM 到 11-04 还没点头就顺延，不算失败。
---
台账设计稿 v0.9.1 的 §3.3 §6 §10「第 0 步」：回链列迁移，独立 PR，先于一切（后面的台账迁移要靠它把工单和执行项挂到广告请求上）。
改动：两张表各加可空列 agent_request_id（不挂外键，因为请求表还不存在），工单表再加 agent_request_prev_id；触发器保证回链列只能写一次，唯一例外是后继请求接手前任工单一次（会话标记 + 表属主角色 + prev 原为空）；另有三道守卫：已绑定的工单不许删、已绑定的行不许改主键 id、插入工单时不许带 prev（独立审查指出这三种写法能绕过只管 UPDATE 的触发器）。
不做：不 apply（等 PM 显式授权）、不动授权和 RLS、不写任何数据；执行项允许删除（调度器会删待处理项，有意保留，写进设计稿残余风险）；「前任已终态、后继的 supersedes 等于旧值」由后续的台账函数核，不在这里。
当场试跑：本机真 PostgreSQL 29 条测试全过，从零重放 325 个迁移 0 失败、4 条数据库安全不变量全过；故意把触发器改坏 15 处抓住 14 处（余下 1 处与另一条规则重复，等价）。
