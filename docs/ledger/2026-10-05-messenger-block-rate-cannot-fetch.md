---
id: 2026-10-05-messenger-block-rate-cannot-fetch
title: 私信屏蔽率这一轮取不到：Meta 有这个数，但我们的授权里没有读洞察的那一项
status: decided
owner: pm
decided_on: 2026-10-05
source: session:1371db1a
verify_by: 2026-10-12
verify_how: PM 决定是否补授权；补授权要所有已连客户重新点一次连接 Meta，会让现有连接断线，所以不在本轮做
---
Meta 的页面消息洞察有「被屏蔽对话数」「被举报对话数」，但要 read_insights 权限，授权清单 META_PAGE_SCOPES 里没有。
本轮不改授权范围，也不用别的数顶替；报告里写「取不到」。
