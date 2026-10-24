---
id: 2026-10-21-ad-heartbeat-hidden-account-money-watch
title: 广告心跳第一版整体跳过被隐藏的旧个人账户，该账户的日预算钱风险暂由追踪检查兜底，需单独低频读钱
status: decided
owner: agent
decided_on: 2026-10-21
source: pr:3037
verify_by: 2026-10-28
verify_how: 在心跳设计第⑤块或单独小任务里加「隐藏账户每日一次低频读日预算/花费」；到期前确认 122 的追踪检查「账户与账单」灯仍会在旧账户开着预算时变红（PR 3032）。负责人：119 号窗口。
---
心跳 v1 对 hidden_from_ad_health 的账户整体 skipped_hidden，旧个人账户里若有开着的日预算，心跳不会报。目前只靠追踪检查那条灯兜底。live 模式开启前必须有一个明确的读钱方案。
