---
id: 2026-09-28-kernel-architecture-tests-pre-existing-red
title: Kernel 那两份架构自检测试目前是红的，跟本轮广告熔断改动无关，是欠账
status: decided
owner: agent
decided_on: 2026-09-28
source: session:d9b147f8
verify_by: 2026-10-05
verify_how: 谁要动 src/lib/kernel/gateway.ts / store.ts / human-approval.ts 之前，先单独跑一遍这两个文件的测试（`ads-autonomy-sync-architecture.test.ts` 和 `kernel-approval/__tests__/architecture.test.ts`），确认这 4 条失败还在、没有变多。变多了就是新引入的欠账，要单独查。
---
本机在 `feat/ads-wp3-1b-v2` 分支的干净提交（`68569601`，我这轮改动之前）上单独跑过，这 4 条本来就是红的，不是我这轮改动引入的：

1. `gateway.ts` 从 1222 行涨到了 1567 行——有个"历史欠账只准变短不准变长"的自检测试在盯着这个数字，现在超了。
2. `store.ts` 现在 873 行，越过了这份自检设的 800 行上限。
3. `human-approval.ts` 里有个函数（`commitApproval`）62 行，越过了 50 行上限。
4. 一个migration 白名单检查（`client_automation_policies` 表只许特定几份 migration 写）报了不在白名单里。

这几件事都跟这几个文件本身的历史欠账有关，跟广告熔断那批改动没关系——我这轮一个字都没碰这三个文件。核实方法：把我这轮未提交的改动先用 `git stash` 存起来，在干净的上一个提交上单独跑这几份测试，同样是这 4 条失败，再把改动原样取回来。

这件事本身不需要谁去修——只是记一笔，免得以后谁在这几个文件上改动时，把这 4 条失败误以为是自己引入的、白白排查一路，或者反过来把自己真引入的新失败当成"反正一直是红的"放过去。
