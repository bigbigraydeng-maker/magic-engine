---
id: 2026-10-12-cts-voipline-next-blocks
title: CTS 电话后续几块还没做：录音下载、转写、摘要、待确认页面、保存期限、漏接对账
status: decided
owner: agent
decided_on: 2026-10-12
source: pr:2462
---
都依赖 PR 2462 合并并拿到真实事件样例。要点：录音下载（私有桶、按客户路径、有状态可重试）；转写与摘要失败不得降级成假摘要；待确认队列要有页面并进今日待办；保存期限需 PM/CTS 定；用 VoIPLine 通话历史补拉对账（需 API 许可与出口 IP 白名单）；转写前过客人对话入库三条红线。
