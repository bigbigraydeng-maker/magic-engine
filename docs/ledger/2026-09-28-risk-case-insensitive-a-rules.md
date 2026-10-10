---
id: 2026-09-28-risk-case-insensitive-a-rules
title: A 级规则大小写不敏感匹配——堵住 macOS ignorecase 绕过漏洞
status: done
owner: pm
decided_on: 2026-09-28
source: session:679ea2bf
verify_how: 用 A_PATHS 每条路径的大小写混合变体跑 classifyFile，全部仍判 A；跑 vitest run tools/ops-review-loop/tests/risk.test.ts 全绿
done_on: 2026-09-28
done_ref: pr:2156
last_checked: 2026-10-10
check_note: 连续两晚判不了：PR 已合并，但 verify_how 要求的线上实证夜巡取不到，交 PM 决定是否关卡
---

ruleMatches 对 A 规则启用大小写不敏感比较，堵住 macOS core.ignorecase=true 绕过漏洞。C 规则不变，避免 B 降 C。
狄仁杰对 PR #2153 的攻击审查发现：claude.md / .Claude/ / .GitHub/ 等大小写变体路径可绕过 A 级判定。
