---
id: 2026-11-01-social-wp1-p1c-pickreceipt-whitelist
title: 社媒读回 P1c：pickReceipt 白名单与 T15 契约测试
status: done
owner: agent
decided_on: 2026-11-01
source: doc:docs/specs/2026-10-29-social-wp1-readback-implementation-brief-v2.md
done_on: 2026-11-01
done_ref: pr:pending
verify_how: npm test 跑 post-measurement-contract 与 post-performance；变异：去掉白名单或 W3 允许 48 时 T15 应变红
---

Ray 2026-11-01 23:38 NZDT 授权 social read-back。P1c（B 级）：从 W1 导出 `PUBLISH_MEASUREMENT_WINDOW_SET`，W6 `pickReceipt` 只在该集合内取最大窗口；T15 契约测试锁住 W1/W3/W4/W5/W6 与 pickReceipt 行为。
