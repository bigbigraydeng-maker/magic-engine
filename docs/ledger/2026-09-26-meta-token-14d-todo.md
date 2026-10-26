---
id: 2026-09-26-meta-token-14d-todo
title: Meta 主页发帖令牌距到期 ≤14 天进今日待办，硬约束不晚于 10-15 上线
status: decided
owner: agent
decided_on: 2026-09-26
source: session:bf0cd6eb
verify_by: 2026-10-15
verify_how: 生产 pm-todo/manual-items 出现新判据类型（读 platform_oauth_connections.expires_at 与 now() 差值 ≤14 天）；CTS 主页令牌 11-02 到期，10-15 生产实测能看到卡片；PR 已合并入主干；台账夜巡 10-16 之后盖章
---
工作包 C：pm-todo 加"距 expires_at ≤14 天"判据，命中下发"重新授权 Meta 发布权限"待办。理由：CTS 令牌 11-02 到期，现在系统只在令牌已死之后才报（`meta_token_dead` code 190），历史死过一次半天恢复。改动只加 pm-todo 判据，不改令牌本身也不外发，风险 C；§11 频率低（60 天一轮）+ IMPACT 高（能力停摆）+ 收入高（客户断供）→ P1。日历兜底 10-19 提醒 PM 手动查已建。PM 2026-09-26 通过小秘书授权全做。
