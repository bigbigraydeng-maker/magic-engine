---
status: pending
decided_at:
decided_by:
pr:
tags: [governance, pm-decision]
---

# 必读文档是否升为 A 级——需要 PM 决策

## 问题

CLAUDE.md 列为必读但当前判 C 的文件，狄仁杰建议考虑升为 A 级。升 A 意味着每次改动都需要 PM 批准。

## 数据（近 30 天 main 上的提交数）

| 文件 | 提交数 |
|---|---|
| docs/PITFALLS.md | 23 |
| docs/STATE.md | 13 |
| docs/DECISIONS.md | 9 |
| docs/strategy/ME_PRODUCT_DEFINITION.md | 0 |
| docs/roadmap/2026-08-19-me2-platformization-principle.md | 0 |

## 取舍

- PITFALLS/STATE/DECISIONS 改动频繁，升 A 会显著增加 PM 审批工作量
- 两份 strategy/roadmap 文件无改动，升 A 成本为零
- 不升级则这些文件仍可被大小写变体绕过（但内容被恶意改写的实际影响比 CLAUDE.md 低）
