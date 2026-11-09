---
id: 2026-10-24-exclusive-claim-budget
title: 同一目标的预算和成交不能被两份处方同时认领
status: done
owner: agent
decided_on: 2026-10-24
source: pr:3084
verify_by: 2026-10-31
verify_how: 在含本改动的分支运行 npx vitest run src/lib/marketing-plan/promo/__tests__/exclusive-claim.test.ts，退出码为 0。日期重叠的第二份已批准处方不能再占同一段预算；同一笔成交不能计两次。
done_on: 2026-10-24
done_ref: commit:58af57e66820f83a2e18bda971299867fd41dd63
---
只加判断，批准路径的行为没变。未知金额不当成 0。
草稿、已完成、已归档、已替代不占预算。日期只相接不算重叠。
这张不改批准路由，也不使用定金或座位规则。
