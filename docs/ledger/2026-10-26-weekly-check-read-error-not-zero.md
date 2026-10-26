---
id: 2026-10-26-weekly-check-read-error-not-zero
title: 周二复查读不到方案的执行阶段时，写「读不到」，不再写成「一个阶段都没有」
status: done
owner: agent
decided_on: 2026-10-26
source: pr:3203
verify_by: 2026-10-28
verify_how: 看 2026-10-27 周二复查那次运行记录——任务正常跑完、每份方案都有人话；若当次日志出现 `[strategy/initiatives] initiatives query error`，对应方案的人话必须是「目标下的阶段这周没读出来」，不能是「目标下现在有 0 条阶段」或「目标下还没有阶段」的建议。当次没有这条报错就以本 PR 的读出错测试为准，判成。
done_on: 2026-10-26
done_ref: pr:3203
---
来源：PR 3160（周二任务改为复查已批准方案）合并时留下的 Claude P1。
根因：listInitiativesForGoal 读出错只记日志返回空列表，getExecutionSummaryForGoal 据此返回全 0 摘要，stageFact 只认 null 为读不到，于是读失败被写成 0 个阶段。
修法：新增 readInitiativesForGoal 返回 ok/error 两种结果；执行摘要读出错返回 null（周二复查走已有的「读不到」文案）；旧函数对外行为不变。
