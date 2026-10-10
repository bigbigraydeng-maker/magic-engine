---
id: 2026-10-09-cts-page-partner-access-request-for-system-user
title: 已向 CTS 主页申请合作伙伴访问，等主页管理员批准后再把主页分配给公司系统用户
status: decided
owner: pm
decided_on: 2026-10-09
source: session:26e33e72
verify_by: 2026-10-12
verify_how: 看 Magic Engine 商务账户的公共主页列表里 CTS Tours 是否出现；出现再分配给系统用户并只读验证，没出现就催管理员批准
---
2026-10-09 PM 说「加」；45 号窗口用已登录的 Chrome，从 Magic Engine 商务账户发出「请求主页共享访问」，不转移所有权。
申请的权限只有四项：内容、社群动态、消息和通话、潜在客户。依据：docs/audits/2026-10-08-meta-token-and-publish-stability.md 第 6.2 节。
批准人：CTS 主页有完全控制权的两位管理员（Pengyu Deng、Gavin Cao）之一本人点批准；回滚＝在 Magic Engine 商务账户取消申请或移除该主页。
另发现：CTStours 商务账户对同一主页也有一条待批申请，主页所属商务账户不是这两个之一；重新生成系统用户钥匙要等 PM 回「换」。
