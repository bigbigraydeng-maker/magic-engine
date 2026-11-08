---
id: 2026-11-03-social-readback-panel-r1
title: 社媒 R-1：本周总览下「发后成绩」只读面板（图文 / Reel / Story，T+4 与 T+72）
status: done
owner: agent
decided_on: 2026-11-03
source: pr:3548
verify_by: 2026-11-10
verify_how: 管理员打开客户社媒日常「本周总览」，总览下方有「发后成绩」；Network 里 GET social-readback 为 200；未到点显示「还没到点」，无回执显示「过点没读到」，非数字不冒充 0；非管理员 403。与已有「发出去的 Reel 72h」块（reel-readback）并存、不重复审批或发布。
done_on: 2026-11-09
done_ref: pr:3548
---
调研报告 R-1：接 loadPostPerformance，纳入 factory_reel；只读 API + 面板。不碰周包批准、cron 登记、Meta 权限、迁移。R-2/R-3 另开 PR，不与此合并。
