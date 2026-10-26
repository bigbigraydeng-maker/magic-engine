---
id: 2026-10-25-kernel-scan-no-clock
title: 架构测试只看白名单结果，不再卡 15 秒
status: done
owner: agent
decided_on: 2026-10-25
source: pr:3096
verify_by: 2026-10-31
verify_how: 本 PR 的 Kernel architecture test 为绿，失败日志里不再出现 15000ms 超时
done_on: 2026-10-25
done_ref: pr:3096
---
人工触发那两条全仓扫描，通过条件仍是白名单结果。15 秒是墙钟上限，1 核检查机上扫描有时超过它，断言还没跑就被掐掉。
这条 PR 只拿掉这个上限。主干上同一条测试也会这样偶发失败，不是这次风险解析改动引入的。
