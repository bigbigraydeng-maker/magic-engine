# docs/archive — 归档区

**这里的东西都不代表现状。** 保留是为了追溯「当时为什么那么做」，不是为了照着做。

现状请看 [../STATE.md](../STATE.md)。

## 2026-07-25 归档批次

| 文件 | 原位置 | 为什么归档 |
|---|---|---|
| `ROADMAP-full-2026-07-25.md` | `/ROADMAP.md` | 4993 行、344 已完成 + 147 未完成混排。已拆成 `../ROADMAP.md`（只留未完成）+ `../history/CHANGELOG.md`（完成日志）+ `../DECISIONS.md`（决策日志） |
| `AUTOMATION_SPEC.md` | `/AUTOMATION_SPEC.md` | Airtable × Zapier 链路已废。Zapier 代码里完全没有，Airtable 退役中 |
| `BILLING_TOKEN_SYSTEM.md` | `/BILLING_TOKEN_SYSTEM.md` | MLT 计费体系已被 MTC 取代（`MLT` 在 `src/` 中 0 引用） |
| `PLATFORM_ARCHITECTURE.md` | `/PLATFORM_ARCHITECTURE.md` | 同上（含 MLT 套餐表）；产品定位部分已并入 `../PRODUCT.md` |
| `MODULE_MAP.md` | `/MODULE_MAP.md` | 引用的 `src/lib/semrush/` 等路径已不存在；模块映射已并入 `../STATE.md §3` |
| `spec-diagnostic-engine.md` | `docs/specs/archive/` | 早期诊断引擎 spec |
| `claude-code-prompts-547.md` | `docs/specs/archive/` | 与 `../claude-code-prompts.md` 是同一份的两个版本（这份 547 行更全） |
| `feimaotui-test/` | `docs/feimaotui-test/` | 与 ME 产品无关的外部测试记录 |

**同批删除**（不在此目录，已从仓库移除）：`TESTING.md` / `QUICK_REFERENCE.md` / `PROJECT.md`
—— 三份都是前身项目 **CrazyContent** 的遗留文档，引用的路径、部署平台（Vercel）、仓库名全部不成立。
`DEPLOYMENT_RENDER.md` 也一并删除，内容并入 `../STATE.md §1`。

## 更早的归档

`MAGIC_ENGINE_PHASE2-5.md` · `ROADMAP-phase1-7.md` · `DAY2/DAY3_SUMMARY.md` ·
`DIAGNOSTIC_*.md` · `E2E_TEST_REPORT.md` · `COMPLETION_CHECKLIST.md` 等
—— Phase 1-7 时期的阶段性文档。
