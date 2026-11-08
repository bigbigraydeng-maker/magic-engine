---
id: 2026-11-08-monthly-report-ads-section
title: 客户月报付费广告只读板块（L2）
status: done
owner: agent
decided_on: 2026-11-08
source: pr:3660
verify_by: 2026-11-15
verify_how: PR 上 monthly-ads-section 与月报页相关测试通过；API 仍走既有付费客户鉴权，不改 Meta、不写预算。
done_on: 2026-11-08
done_ref: pr:3660
---

月报从已同步表汇总当月广告块，缺数据写入 gaps。不改 boundaries、预算卡或 winner sync。
