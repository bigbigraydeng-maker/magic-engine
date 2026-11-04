---
id: 2026-11-03-oauth-transient-classifier-tighten
title: 收紧授权刷新「临时故障」判断：只认状态码，不在对方原文里找字样；魏征补审另外三条小问题留作后续
status: done
owner: agent
decided_on: 2026-11-03
source: pr:3560
verify_by: 2026-11-06
verify_how: 11-04、11-05 两天 google-data-pullback-daily 没有新增被标 error 的授权连接；platform_oauth_connections 里 status=error 的行数不比 11-03 多（11-03 为 7 条，其中 2 条 GA4 已改回 active）
done_on: 2026-11-03
done_ref: pr:3562
---
魏征（Opus）对已合并的 3560 补审：没有 P0/P1，无需回滚；P2-1（整段原文里找 network 字样会把被拒绝的授权误当临时）本 PR 修掉，并把 JSON 读断归为临时。
留作后续（不在本 PR）：P2-2 我们自己的问题（缺配置、没支持刷新的平台）仍会把连接标 error；P2-3 临时失败没把原因写进连接的 error_message，谷歌商家资料 / 广告 / GTM / YouTube 没有心跳判据；P2-4 发邮件处碰临时失败仍提示「邮箱授权掉线」。11-24 前看上线后一个月里这几种实际出现过几次再决定修不修。
