---
id: 2026-09-28-cts-ads-report-move-to-backend
title: 候选：把 CTS 广告日报从这台电脑的定时任务搬进 ME 后台，不再被本机卡住的任务堵住
status: decided
owner: agent
decided_on: 2026-09-28
source: doc:docs/sops/cts-project-manager-playbook.md
verify_how: ME 后台有一条每天跑的广告日报任务，连续 3 天在新西兰时间 10 点前出报告，且这台电脑关着的那天也照常出
---
本机检测只能发现漏跑，检测自己也跑在同一个会被堵的调度上，所以根治要搬进后台（Render 定时任务 / Inngest）。
先查 src/lib 里已有的 Meta 广告取数封装再动手，别新写一套。优先级待排。
