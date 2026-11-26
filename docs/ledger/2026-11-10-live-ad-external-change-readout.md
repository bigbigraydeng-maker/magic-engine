---
id: 2026-11-10-live-ad-external-change-readout
title: 推广计划在投面板标出 Meta 侧改预算/状态
status: done
owner: agent
decided_on: 2026-11-10
source: pr:3694
verify_by: 2026-11-17
verify_how: 管理员打开推广计划页，在投对上区块出现「不是在 ME 里改的」一行且带两次快照时间。
done_on: 2026-11-10
done_ref: pr:3740
---
只读比对 ad_entity_snapshots 与 action_runs，不写 Meta、不加按钮。
