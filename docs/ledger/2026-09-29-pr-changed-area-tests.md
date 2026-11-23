---
id: 2026-09-29-pr-changed-area-tests
title: 每个改代码的 PR 自动跑「受它影响的测试」，只拦这个 PR 新弄红的，主干原本就红的不拦
status: done
owner: agent
decided_on: 2026-09-29
done_on: 2026-09-29
done_ref: pr:2188
verify_by: 2026-10-06
source: session:d9e2c2a5
verify_how: 开出的 PR 上「Changed-area tests」检查真跑了且结果正确；用 PR 1942 那次改动（共享 Meta 版本号）本地重放，检查必须变红并点名那两个过时测试
---
起因：2026-09-27 共享 Meta 版本号改了以后，src/lib/meta 与 src/lib/inngest 的测试在主干红了 4 天没人发现（修复在 #2115）。
做法：pr-application-validation.yml 新增 job，逻辑在 scripts/ci/changed-area-tests.sh；scripts/ci/ 判 A 级。本地重放 #1942 已变红（点名 5 条），空改动已知红区不拦。
后续：是否设成主干必过由 PM 定；合并后一周看它在真实 PR 上有没有误拦。
