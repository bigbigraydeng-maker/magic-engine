---
id: 2026-10-25-exclusive-claim-budget
title: 同一目标的重叠预算和同一笔成交不能被两份处方同时认领
status: done
owner: agent
decided_on: 2026-10-24
source: pr:3079
verify_by: 2026-10-31
verify_how: PR 3084 的 exclusive-claim 测试退出码为 0；批准路由仍不调用这段判断
done_on: 2026-10-24
done_ref: pr:3084
---
纯函数在推广计划目录。诊断处方、推广计划、广告日处方只读现有类型。
金额缺失记为未知，不当成 0。广告日处方类型没有预算字段，读出来不占预算。
批准路由不在这张里改。接入点写在 PR 3084。
