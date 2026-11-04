---
id: 2026-10-29-cts-quoted-stage-not-real-for-travel
title: CTS 客户系统里有个"已报价"阶段，但旅游业务没有报价这一步，AI 却在自己往里填，要改掉或改成真实含义
status: decided
owner: agent
decided_on: 2026-10-29
source: doc:docs/specs/2026-10-29-ads-crm-signal-to-meta-design-v0.3.md
verify_how: CTS 的阶段配置里不再有业务上不存在的"已报价"，或已改成真实含义；之后 14 天内 AI 不再写入旧的"已报价"（按阶段流水里 AI 身份的记录核对）
---
PM 2026-10-29：旅游行业不存在报价逻辑，填表即潜在客人，后续持续种草。
只读实查：CTS"已报价"84 次进入记录里 75 次是 AI 读通话邮件后自己填的，人改 9 次；这批数据不能当广告信号用。
归 CRM 那条线处理（去掉该阶段，或改成"已发行程 / 价格资料"等真实含义并让 AI 按新含义判断）；本卡只定验收口径。
