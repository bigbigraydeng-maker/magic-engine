---
id: 2026-11-02-ads-approval-readback-cooldown
title: 广告批准页只读上下文：上次动作、读回一致性与 72h 冷却（D3 verify / O1 readback / CBO 实体范围）
status: verified
owner: agent
decided_on: 2026-11-02
source: pr:3522
done_on: 2026-11-02
done_ref: pr:3522
verify_by: 2026-11-05
verify_how: 合并后员工打开广告健康设置里 O1/D3 批准区：见上次动作与读回文案、冷却到点说明；Vitest load-adset-approval-context 与 approval-context 路由绿。见 doc:src/lib/ads-strategy/approval-run-context/load-adset-approval-context.ts
last_checked: 2026-11-05
verified_ref: evidence/2026-11-02-ads-approval-readback-cooldown--20261105.md
check_note: PR3522 已合并；load-adset-approval-context 测试 10/10 通过，审批页上次操作/回读/冷却逻辑正确
---
#3520 只读闭环 B：GET approval-context 聚合 adset 上次内核动作、verification 读回与 envelope 对齐的冷却实体；不改 Meta、不改内核执行。
