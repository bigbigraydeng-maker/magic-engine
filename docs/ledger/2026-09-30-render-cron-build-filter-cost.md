---
id: 2026-09-30-render-cron-build-filter-cost
title: 发布后核对 Render Cron 构建过滤生效并保持运行
status: decided
owner: pm
decided_on: 2026-09-30
source: pr:2203
verify_by: 2026-10-07
verify_how: "Render Blueprint 应用后核对 55 个 Cron 的过滤规则；查看过滤后代码提交是否跳过自动构建；确认至少一个现有排程任务成功且命令和排程未变；分别记录 Pipeline Minutes 与 Cron Jobs 用量。"
---
此卡跟踪 PR #2203 的首次发布后核验。Cron 继续按原排程调用线上 API；过滤规则不免除运行费用。若无法确认自动构建被跳过或计划运行成功，转交 PM，不推断节省额。
