---
id: 2026-09-28-risk-case-insensitive-a-rules
title: A 级规则大小写不敏感匹配——堵住 macOS ignorecase 绕过漏洞
status: done
owner: agent
decided_on: 2026-09-28
source: session:679ea2bf
verify_how: 用 A_PATHS 每条路径的大小写混合变体跑 classifyFile，全部仍判 A；跑 vitest run tools/ops-review-loop/tests/risk.test.ts 全绿
done_on: 2026-09-28
done_ref: pr:2156
last_checked: 2026-10-05
check_note: 10-05 夜巡未核查本卡判据（夜巡只有本地只读权限，无生产库、登录态或外网），待人工或下一轮核查
---

ruleMatches 对 A 规则启用大小写不敏感比较，堵住 macOS core.ignorecase=true 绕过漏洞。C 规则不变，避免 B 降 C。
狄仁杰对 PR #2153 的攻击审查发现：claude.md / .Claude/ / .GitHub/ 等大小写变体路径可绕过 A 级判定。
