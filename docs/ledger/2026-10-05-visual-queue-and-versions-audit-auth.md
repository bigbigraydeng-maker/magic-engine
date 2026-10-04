---
id: 2026-10-05-visual-queue-and-versions-audit-auth
title: visual/queue 与 visual-assets/[assetId]/versions 疑似也无登录检查，需确认
status: decided
owner: agent
decided_on: 2026-10-05
source: session:07fc4e50
verify_how: 逐个读代码得出「有/无鉴权」结论，有漏洞的补卡
---
全仓扫描助手顺带发现这两个路由没有鉴权关键字，但不在本次扫描清单内（可能只是读接口）。
动作：逐个读代码确认是否泄露别家客户素材，需要的话按同族修法补上。
