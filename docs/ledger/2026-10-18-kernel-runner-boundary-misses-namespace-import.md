---
id: 2026-10-18-kernel-runner-boundary-misses-namespace-import
title: 「谁能触发内核真正执行动作」的唯一机器防线只查具名导入——整体引入或动态引入都绕得过
status: decided
owner: agent
decided_on: 2026-10-18
source: session:c668eb35
verify_by: 2026-11-03
verify_how: 在 kernel/__tests__/architecture.test.ts 里加两个故意违规的合成样例（整体引入 import * as K 后调 K.runAction；动态 await import）确认测试变红；再修 runnerSymbolViolations 让它覆盖 NamespaceImport 与 import() 调用。另评估「发事件间接触发 action-submission 调用方」这条能不能也被机器抓到（可能不能，要明写为已知缺口）。属 A 级（碰内核边界测试），要写代码，等 PM 排
---
魏征复审编排层 v0.5 时提出、我读 architecture.test.ts:1930-1936 核实：if (!bindings || !ts.isNamedImports(bindings)) return，非具名导入直接放行；遍历的节点只有 ImportDeclaration / ExportDeclaration。
现实风险：目前没有证据有人这样绕；这是潜伏的洞，不是正在发生。但这条测试是 KERNEL_RUNNER_SYMBOLS 六个推进函数的唯一机器防线，写 boundaries.ts 注释时作者特意强调「穷举白名单、不是黑名单」，而这里恰是黑名单式的漏判。
按 §11：频率 低 · 影响 高（绕过即无授权真执行）· 收入 高 → P1。
