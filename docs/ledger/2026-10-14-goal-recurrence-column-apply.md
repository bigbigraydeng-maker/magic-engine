---
id: 2026-10-14-goal-recurrence-column-apply
title: 给目标表加「每月自动续建」标记那一列（等 PM 回「加列」），之后才能跑线上试跑
status: decided
owner: pm
decided_on: 2026-10-14
source: pr:2428
verify_by: 2026-10-16
verify_how: PM 回「加列」后：库里目标表出现 recurrence 列；把 NAL 十月那条（2026-10-01~10-31）标成每月续建；带密钥访问 goals-expiry-check?dry_run=1 返回 200 且 planned 不含十月；再真跑一次十月仍只有 1 条。撤回办法：删掉该列和同名索引 uniq_goals_monthly_per_client_metric_month。
---
PR 2428 已合并，NAL 十月目标已补建（只有一条），但迁移没有自动上库：库里没有 recurrence 列。
没加之前，每天的目标过期检查「标过期」正常、「续下个月」那步报错，十一月前对 NAL 无实际影响。
迁移文件：supabase/migrations/20261010090000_goal_monthly_recurrence.sql（只加可空列和索引，不改现有数据）。
