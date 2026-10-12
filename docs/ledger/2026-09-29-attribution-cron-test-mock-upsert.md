---
id: 2026-09-29-attribution-cron-test-mock-upsert
title: attribution 定时任务的测试跟上运行日志新写法：9 月 9 日起一直红着的 31 条测试转绿（只改测试，不改业务代码）
status: verified
owner: agent
decided_on: 2026-09-29
source: session:609cc526
verify_by: 2026-10-01
verify_how: PR 合并后在主干跑 npx vitest run src/app/api/cron/attribution，34 条全过算成；到期 PR 还没合并就判不了，check_note 写「A 级等 PM 合」
done_on: 2026-09-29
done_ref: commit:fa789db249b44b85d46b22bda588c1352d36c03f
last_checked: 2026-10-12
check_note: 本地跑 vitest 34/34 通过，判据满足
verified_ref: doc:docs/ledger/evidence/2026-09-29-attribution-cron-test-mock-upsert--2026-10-12.md
---
根因：运行日志收尾从 update 改成 upsert（PR #1434，2026-09-09 进主干），这份测试的假 Supabase 没跟上，31 条都报 upsert is not a function；业务代码没坏。
改法：假件照现写法建模（开跑 await insert，收尾 await upsert），收尾那一行照旧记下来，原有断言一字未改；故意改坏业务代码 3 处，测试分别变红 6/2/1 条。
没有任何 CI 跑这份测试，所以红了 20 天没人发现。
机器判级 A（src/app/api/cron/ 目录一律 A），开发风险 C；A 级不自动合，等 PM 决定。
