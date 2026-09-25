---
id: 2026-09-25-merge-gate-machine-not-human
title: 合并代码不做成"每次要 PM 在 GitHub 点头"的人工闸；改成机器闸，并把现在假的「合并审批（Ray）」检查改成实话
status: done
owner: agent
decided_on: 2026-09-25
source: session:31cdcfa9
verify_by: 2026-10-09
verify_how: 仓库里不再存在名为「合并审批（Ray）/ Merge authorization (Ray)」却无条件自动通过的检查（改名为它实际做的事，或移除）；.github/merge-authorization.md 写明各风险级由哪些机器检查放行；A 级 PR 在复审签字有机器可读记录之前不自动合
done_on: 2026-09-26
---
PM 2026-09-25 原话："那肯定不要每次都让我点，我们是 build 一台流水线的机器。"
背景：该检查 5 秒自动过，从未真拦过；真正拦住"未经 PM 同意就合并"的只有写给 agent 的文字规矩（审计已证明文字规矩不起效）。
落点：C/B 级靠 CI + 台账检查；A 级靠 tools/ops-review-loop 的定级与 gate marker（计划 B3 接线后）。
