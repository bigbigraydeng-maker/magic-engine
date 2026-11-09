---
id: 2026-10-18-foundation-5-intake-ci-check
title: 地基块 5——立项卡的机器检查（新增 Agent 目录、定时任务或 Inngest 函数时要求有立项卡）：要改 .github，A 级，冻结中等 PM 排
status: decided
owner: pm
decided_on: 2026-10-18
source: session:c668eb35
verify_by: 2026-11-03
verify_how: PM 是否在问题 1 排了期。排了之后验收：开一个故意不带立项卡、却新增 src/lib 新目录的测试 PR，检查必须变红；带上合格立项卡且 9-24 §4.4 有对应行后变绿；只放 TEMPLATE.md 不能让它变绿
---
v1.0 地基清单第 5 块（原 v0.2 §8 第 5 条）。没有它，第 1 关全靠窗口自觉——魏征复审判它是「最先会被跳过的一关」。
最小做法：扩展现成的 .github/workflows/ledger-check.yml，不另建检查。改 .github 是 A 级，需 PM 本人点头。
