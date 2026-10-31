---
id: 2026-10-31-paused-draft-existing-campaign
title: 暂停草稿可以往已有系列里加一个暂停广告组
status: done
owner: agent
decided_on: 2026-10-31
source: doc:docs/ledger/2026-10-27-paused-draft-confirmation.md
verify_by: 2026-11-14
verify_how: 定向测试里，带已有系列编号时不新建系列、新组是暂停、账户对不上就不写、回读对不上就拦住且不关原系列。
done_on: 2026-10-31
done_ref: pr:3437
---
仍走暂停草稿确认卡：先出卡，日上限和身份不过就不能点确认。点了才建，建完回读，记到动作记录。
不新建系列。原系列的开关这次不动。开投时也不把原系列一起打开。
开投确认卡的重试和补暂停同样不碰原系列。原系列本来暂停时，不把它算进「已经在投」。
和还没合的计划步骤出卡那一叠分开做。那一叠出的草稿只要带上已有系列编号，就会走这里。
