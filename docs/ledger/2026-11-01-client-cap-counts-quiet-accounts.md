---
id: 2026-11-01-client-cap-counts-quiet-accounts
title: 客户广告日上限要把没出新草稿的账户上正在花的钱也算进去
status: done
owner: agent
decided_on: 2026-11-01
source: pr:3437
verify_by: 2026-11-08
verify_how: 一个账户只有正在花的钱、没有新草稿，另一个账户有新草稿，加起来超过客户日上限时，预算检查是红灯或灰灯，不能通过。
done_on: 2026-11-01
done_ref: pr:3437
---
客户日上限按全部广告账户的已在投加这份新草稿一起比。某个账户这次没有新草稿，它正在花的钱仍然算进合计。哪个账户读不全，整笔就是灰灯，不当成零。
