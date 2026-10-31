---
id: 2026-10-31-plan-step-placement-lock
title: 计划步骤写了投放位置，新建暂停广告组就按它锁，并回读核对
status: done
owner: agent
decided_on: 2026-10-31
source: doc:docs/ledger/2026-10-05-ads-thruplay-placement-lock.md
verify_by: 2026-11-14
verify_how: 定向测试里，草稿带计划版位时写入广告组并按计划回读；空列表仍按今天的做法；不认识的位置一次都不写。
done_on: 2026-10-31
done_ref: pr:3436
---
计划步骤写了投放位置，就写进新建广告组，建完按计划回读。没写就仍按今天的做法。
只投 Instagram 是计划里的一个选项，不是写死给某一个客户的。
不能选 Audience Network。往已有广告组加广告不会改它的版位。版位不是一列文字就拦住，不去建。
和计划步骤出卡那一叠分开。那一叠把步骤上的位置抄到草稿上，就会走这里。
