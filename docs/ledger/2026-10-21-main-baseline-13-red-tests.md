---
id: 2026-10-21-main-baseline-13-red-tests
title: 主干现在有 13 条测试是红的：8 条是写死 9 月日期的「日期炸弹」，另有登记表 2 条、测量合同 1 条、对外文案 2 条，GitHub 检查被账单锁住没人看到
status: done
owner: agent
decided_on: 2026-10-21
source: session:ec90bb17
verify_by: 2026-10-28
verify_how: 在主干上跑 npx vitest run src/lib/ads-strategy/__tests__/circuit-state.test.ts src/lib/ads-strategy/__tests__/daily-insights.test.ts src/lib/meta/ai/__tests__/public-copy.test.ts src/lib/inngest/functions/__tests__/post-measurement-contract.test.ts，全部通过；日期炸弹那 8 条不再依赖真实时钟（固定系统时间后也能过，换一天跑结果不变）；public-copy 和 post-measurement-contract 各写明是改了测试还是改了代码、理由是什么。登记表那 2 条归卡 2026-10-21-cron-registry-drift-schedules-and-unowned-writers。
done_on: 2026-10-21
done_ref: pr:2994
---
2026-10-21 122 号在合并基点上复跑发现，统管在干净主干上逐个复核属实：①日期炸弹 8 条：ads-strategy 的 circuit-state.test.ts（listActiveCircuitTrips 4 条）和 daily-insights.test.ts（三个同步入口算时区窗口 4 条），写死 9 月日期却用真实时钟，今天起全红；修法是测试里固定系统时间。
②对外文案 2 条：public-copy.test.ts 期望页面含「连接 Facebook → 选择广告账户 → 生成中文报告」和「公开报名，以及获邀后的托管分析流程」，9-27 自助体检页改版后页面没有了；要判断是页面该改回还是测试该跟上。③测量合同 1 条：post-measurement-contract.test.ts 报 meta/post-engagement.ts 依赖 ./graph-base（9-23 统一 Graph 版本常量时引入）；graph-base 若只是常量就该白名单放行。
④登记表 2 条见卡 2026-10-21-cron-registry-drift-schedules-and-unowned-writers。红了没人看，下一个真问题会被「本来就红」淹没。按 §11 为 P3，但清红便宜（都是测试侧，B 级），派 118 号窗口顺手做。
