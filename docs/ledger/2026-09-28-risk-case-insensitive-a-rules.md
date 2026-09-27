---
status: decided
decided_at: 2026-09-28
decided_by: PM (任务指令)
pr: "#2156"
tags: [governance, security, merge-gate]
---

# A 级规则大小写不敏感匹配

## 结论

`ruleMatches` 对 A 规则启用大小写不敏感比较，堵住 macOS `core.ignorecase=true` 绕过漏洞。C 规则不变，避免 B 降 C。

## 依据

狄仁杰对 PR #2153 的攻击审查发现：`claude.md` / `.Claude/` / `.GitHub/` 等大小写变体路径可绕过 A 级判定，PR 被判为 C 级并自动合并。
