---
id: 2026-10-08-daily-plan-publish-price-gate
title: 每日计划发布出口接上价格检查：文案报价但配图不是客户确认过的，整批拦下
status: decided
owner: agent
decided_on: 2026-10-08
source: session:cf1e84bd
verify_by: 2026-10-10
verify_how: PR 过两审并由 PM 回合后上线；到期看每日计划页点发布演练时，带价格的帖配库存图会被 409 拦下并说明原因
---
PM 2026-10-07 回「合」授权派价格检查（A 级，保持草稿，未合并）。复用 judgeOutgoingPost，挂在发布路由「演练与真发」之前，不动数据库。
当场试跑：真实 CTS 两份计划 14 条（10 条含价格）0 条被拦；负向对照（价格加库存图）被拦。DeepSeek 一轮约 0.01 美元。
