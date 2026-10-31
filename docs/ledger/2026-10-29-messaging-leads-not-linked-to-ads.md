---
id: 2026-10-29-messaging-leads-not-linked-to-ads
title: 私信和 WhatsApp 广告带来的咨询接不上是哪条广告，这部分花费现在判断不了值不值
status: decided
owner: agent
decided_on: 2026-10-29
source: doc:docs/specs/2026-10-29-ads-opportunity-mining-design-v0.3.md
verify_how: 私信类广告带来的咨询在客户系统里能对到广告编号，最近 14 天对上的比例过半，并能算出每次有效咨询成本
---
2026-10-29 只读实查：CTS 二号账户 30 天花约 NZ$298 跑 WhatsApp 私信广告，Meta 报 9 次开聊，客户系统里没有一条能对到这些广告。
广告机会挖掘 v0.3 已先把 Meta 自报的开聊数存下来（meta_messaging），但"开聊之后是不是有效客人"仍接不上。
修法待查：私信进线写入时能否带上广告来源信息；不在机会挖掘那张卡里做。
