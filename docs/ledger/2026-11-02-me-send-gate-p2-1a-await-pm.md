---
id: 2026-11-02-me-send-gate-p2-1a-await-pm
title: 第二步第一批（建表）做好了、等你放行：回「go apply」建表，亲手合并改动单
status: decided
owner: pm
decided_on: 2026-11-02
source: session:33ebcd0b
verify_by: 2026-11-09
verify_how: 看是否已：①回「go apply」且生产库有表 triggered_send_authorizations 与 triggered_sends、有函数 triggered_send_claim；②改动单已合并。缺哪件就如实写缺哪件
---
这一批只建两张表和一个认领函数，并把新代码路径加进合并闸的高风险名单；不发任何信、不改任何联系人、客户看不到变化。碰数据库表，合并要 PM 亲手。
设计与次序：docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §10（P2-1a）。
