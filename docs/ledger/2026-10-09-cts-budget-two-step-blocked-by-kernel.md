---
id: 2026-10-09-cts-budget-two-step-blocked-by-kernel
title: CTS 再营销加两成、Reborn 腾五元：PM 已批但 Kernel 不让加预算，没执行
status: decided
owner: pm
decided_on: 2026-10-09
source: session:4544d90e
verify_by: 2026-10-14
verify_how: 看这两条系列的日预算有没有变成 55 和 48。没变就是还卡着，要么 PM 决定放开加预算入口、要么退回排期；变了要同时能查到 Kernel 回执，没回执等于绕行了
---
PM 2026-10-09 本人回「做」。执行前四项核查：留资成本 8.28 达标、冷却 19/23 天达标、余量改后 118 对 120 达标；学习期这一项平台读不出来。
真正的拦路点是加预算：两条人工路径一条硬拒上调、一条要机器自己先命中机会且要求人工批准规则，两条都不满足，按纪律停手没绕行。
降预算那一步单独走得通，但 PM 批的是成对的两步，只做一半等于白砍预算，所以一步都没做。
顺带查出两个平台缺口，各自要单独开卡：学习期那一列从建表起从没被填过；余量核算函数只能表达加预算、不能表达减预算。
明细见 doc:docs/clients/cts/2026-10-09-budget-two-step-preflight-blocked.md
