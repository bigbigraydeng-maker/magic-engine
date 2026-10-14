---
id: 2026-09-27-page-posts-stale-graph-version-tests
title: Facebook 主页发帖那组测试主干上挂 4 条——是测试写死了旧版本号，不是发帖代码坏了；改成跟共享版本号走，并加一条防回归测试
status: verified
owner: agent
decided_on: 2026-09-27
source: session:f53eddca
verify_by: 2026-09-29
verify_how: 合并后在主干跑 `npx vitest run src/lib/meta/__tests__/page-posts.test.ts src/lib/inngest/functions/__tests__/daily-plan-post-story-resolve.test.ts`，全部通过、零失败算成（2026-10-10 合并主干后实测 57 条，条数会随主干新增测试变化，不作判据）；有一条红就是没修好
done_on: 2026-09-27
done_ref: pr:2115
last_checked: 2026-10-13
check_note: 10-13 现场实跑两个测试文件 57 条全过，退出码 0
verified_ref: doc:docs/ledger/evidence/2026-09-27-page-posts-stale-graph-version-tests--2026-10-13.md
---
根因：PR 1942 把 Meta 模块统一改用共享 GRAPH_BASE（v20.0 → v21.0），这两份测试还写死 v20.0。生产发帖路径只有版本号变了。
只改测试文件，生产行为 0 改动（B 级）。新回归测试做过变异验证：page-posts 若再私自写死版本号，它会按名字变红。
没被 CI 拦住的原因：PR 必跑检查不含 src/lib/meta 和 src/lib/inngest 的测试。这是另一件事，本卡不处理。
