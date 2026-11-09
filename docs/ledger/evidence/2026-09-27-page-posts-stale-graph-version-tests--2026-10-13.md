# 证据 · 2026-09-27-page-posts-stale-graph-version-tests · 2026-10-13

fetched_at: 2026-10-13T10:22Z（UTC，本机现场运行）

查了什么：按 verify_how 在 PR 2554 分支（与主干相比只多 docs/ledger 改动，src 零差异）上跑那两个测试文件。

数字（带样本量、两边取数状态）：
- `npx vitest run src/lib/meta/__tests__/page-posts.test.ts src/lib/inngest/functions/__tests__/daily-plan-post-story-resolve.test.ts` → 退出码 0。
- Test Files 2 passed（2）；Tests 57 passed（57），0 失败、0 跳过。其中 daily-plan-post-story-resolve 26 条。
- 输出里的 stack trace 是测试里故意触发的错误分支日志，不是失败。

来源/命令：同上；HEAD d91e3bdb9；先 `npm ci --ignore-scripts` 装依赖。

结论：成——判据「全部通过、零失败」满足。
