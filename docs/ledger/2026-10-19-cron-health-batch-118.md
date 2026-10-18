---
id: 2026-10-19-cron-health-batch-118
title: 自动任务健康检查从约 226 次数据库请求降到 32 次（今日待办与自动任务健康页加载更快）
status: done
owner: agent
decided_on: 2026-10-19
source: session:ccc90b3d
verify_by: 2026-10-23
verify_how: 合并上线后打开今日待办和 /dashboard/workflows-health，感受是否比之前快；Supabase 日志里 cron_run_logs 的 GET 在页面加载时应从约 200+ 次降到约 25 次；报告内容（失败/卡死/逾期条数）与改前一致
done_on: 2026-10-19
done_ref: doc:src/lib/cron/health.ts
---
统筹 18 号转述：PM 反映合并后后台卡 15–20 秒；只读定位见 docs/specs/2026-10-19-render-deploy-filter-and-load-findings.md。
本卡只管 checkCronHealth 批量化。飞轮归因任务批量化另案；162 行僵尸 running 清理等 PM 点头（写生产库）。
