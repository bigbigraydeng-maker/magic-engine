---
id: 2026-10-28-crm-followup-stop-requests-unflagged
title: 近 120 天有 7 位客人写过 Unsubscribe、Please do not contact me 或 not interested，系统没标别再联系（另 5 位同样只写 Unsubscribe 却被标了）：自动节奏上线前必须清零
status: decided
owner: pm
decided_on: 2026-10-28
source: doc:docs/audits/2026-10-28-crm-followup-flow-audit.md
verify_how: 同事核对这 7 条原话后，在他们的卡片上记一笔「客户说别再联系」（没有直接置位的按钮，/dnc 路由只能取消；这是写生产数据，需 PM 或 CTS 授权，一人一条）。再只读复查：近 120 天说过退订类话的客人里，没标别再联系的应为 0，或各有一句人工说明。同时补两样：单词 Unsubscribe 命中时立刻暂停该人所有自动动作；邮件渠道补和私信一样的只提示通道。
---
12 位客人写过英文退订类话，5 位已标别再联系，7 位没标（4 位 Unsubscribe、1 位 Please do not contact me、2 位 not interested），7 位还在跟进阶段，会继续收到跟进和 newsletter。
同一个词有人被标、有人没标，说明处理不一致；7 人里 6 人在私信、1 人在邮件，其中 6 人说「不要」已超过 30 天，私信退订提示只看 30 天，过期就静默消失；邮件渠道没有这条通道。
CTS 客人入站消息 97% 是英文，英文词表对 CTS 基本够用；中文词表无效是平台问题，对 NAL 等中文客户更严重。按 §11 本条是 P3，但它是自动节奏的前置条件。
