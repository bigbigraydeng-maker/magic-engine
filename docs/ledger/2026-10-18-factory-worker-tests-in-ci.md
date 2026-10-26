---
id: 2026-10-18-factory-worker-tests-in-ci
title: 出片机测试接进 CI（现在 CI 一个出片机测试都不跑，「检查全绿」对人声闸等把关代码没有意义）
status: decided
owner: agent
decided_on: 2026-10-18
source: session:ec90bb17
verify_by: 2026-10-25
verify_how: PR（A 级草稿，需 PM 回「合 N」）合并后：①下一个无关 PR 上出现并通过 factory-worker-tests；②破坏演示——一次性分支故意改弱一条出片机测试，检查必须变红；③观察几个 PR 稳定后，由 PM/18 号决定是否在 Protect main 里升为必过。
---
设计：docs/specs/2026-10-18-factory-worker-ci-design.md。核实：.github/workflows 没有任何 workflow 跑 scripts/factory-worker；出片机 296 条 vitest + 引擎 511 条 node:test 全绿且不依赖 ffmpeg/tesseract；干净检出上 vitest 2 秒、引擎依赖安装 3 秒（缓存）。
