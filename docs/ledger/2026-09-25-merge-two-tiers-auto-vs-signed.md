---
id: 2026-09-25-merge-two-tiers-auto-vs-signed
title: 合并分两档：B/C 级 PR 机器检查全绿自动合、不再问 PM；A 级要审核团队三人签字被机器记录后才合，接线前仍问 PM 一句
status: done
owner: agent
decided_on: 2026-09-25
source: session:31cdcfa9
verify_by: 2026-10-16
verify_how: ①一个只改 UI 文案的测试 PR 在 CI 全绿后无人点击自动合进主干；②一个改 src/lib/kernel 的测试 PR 在没有三人签字标记时合并按钮按不动；③仓库 CLAUDE.md §2「唯一例外」与 .github/merge-authorization.md 已写成两档规则
done_on: 2026-09-26
done_ref: pr:2023
last_checked: 2026-11-20
check_note: PR 2023 已合并；第③项：merge-authorization.md 现写 B/C 检查全绿自动合、A 级只要 Claude Code 签，三人签字已被 10-26 规则替代；第①②项测试 PR 没做过，判不了
---
PM 2026-09-25 回「分两档」（前一条：不做每次人工点头，见 2026-09-25-merge-gate-machine-not-human）。
风险定级用 tools/ops-review-loop/src/risk.mjs（已在仓库、未接线）；A 级签字用 gate-marker（可信身份写入）。
这把计划 B3「审查自动被叫」提前到现在做；派 ME 2.0 构建控制，DeepSeek 执行，子牙+魏征+狄仁杰设计前后各一次。
