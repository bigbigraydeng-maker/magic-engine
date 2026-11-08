---
id: 2026-11-03-refund-without-charge-audit
title: 排查其他功能会不会把没扣过的点数退给客户（张骞这一处已去掉退款）
status: decided
owner: agent
decided_on: 2026-11-03
source: pr:3485
verify_by: 2026-11-10
verify_how: 逐个看还在用 refundOnFail 的功能（博客、生图、Reel 视频、分镜），确认每一处都是先真扣了点数才可能退；有哪处是没扣先退，就开修复单。
---
张骞发现已改成：跑完才扣，失败不退款（PR 3485）。
博客、生图、Reel 等功能是先扣后退，理论上没问题，但没有逐个核过。
