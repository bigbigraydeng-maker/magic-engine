---
id: 2026-10-18-template-wiring-test
title: 加一条测试：引擎里每个新模板必须在出片机的文字/红线复扫接线里，漏接就红
status: decided
owner: agent
decided_on: 2026-10-18
source: session:ec90bb17
verify_by: 2026-10-25
verify_how: 合并后在本机跑 engines/remotion 的 node --test，故意从 TEXT_WIRED_TEMPLATES 删一个 id 必须变红（已在 PR 里演示）。注意：仓库 CI 目前不跑 scripts/factory-worker 的任何测试（vitest 与 node:test 都不跑），所以这条测试目前只在本机起作用——另开 A 级卡「给出片机测试接 CI」。
---
背景：近 14 天至少 5 个窗口改同一批引擎/出片机文件，datacard 曾因漏接被拒单。出片机已在运行时拒绝未接线模板（PR 2772），这条测试把「漏接」提前到测试阶段发现。设计与登记表：docs/clients/cts/2026-10-18-production-line-loop-register.md。
