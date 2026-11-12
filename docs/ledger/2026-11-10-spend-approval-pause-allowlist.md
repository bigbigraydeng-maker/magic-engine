---
id: 2026-11-10-spend-approval-pause-allowlist
title: 暂停广告组的批准入口补进批准人白名单，并让内核检查跑这份测试
status: done
owner: agent
decided_on: 2026-11-10
source: issue:3690
verify_by: 2026-11-17
verify_how: 轻检查的 Kernel architecture test 步骤会跑 spend-approval.test.ts；白名单含 pause-ad-set 的批准调用，且不再要求 o1 批准路由里有批准调用。
done_on: 2026-11-10
done_ref: doc:src/lib/kernel/__tests__/spend-approval.test.ts
---

指针：`src/lib/kernel/__tests__/spend-approval.test.ts` 的批准人白名单，以及 `.github/workflows/pr-light-checks.yml` 的内核检查步骤。
