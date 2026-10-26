---
id: 2026-10-14-goal-recurrence-column-apply
title: 目标表的「每月自动续建」列已加；NAL 十月目标标成每月续建这一步仍待 PM 回「标记」（非 P0）
status: done
owner: agent
decided_on: 2026-10-14
source: pr:2428
verify_by: 2026-10-17
verify_how: 查生产库 goals 表有 recurrence 列、同名索引 uniq_goals_monthly_per_client_metric_month 存在；线上 goals-expiry-check?dry_run=1 返回 200、无报错。PM 之后回「标记」时，再把 NAL 十月那条设成 monthly 并复测「不重复建」。
done_on: 2026-10-15
done_ref: pr:2428
---
2026-10-15 已加列（可空，现有 32 条目标一条未改，非空行 0），同名索引已建；线上试跑 dry_run=1 返回 200、无报错，但还没有任何目标被标成每月续建，planned=0，所以「不重复建」尚未被证明。
回滚加列：drop index if exists uniq_goals_monthly_per_client_metric_month; alter table goals drop column if exists recurrence;
下一步（改现有数据，需 PM 回「标记」，NAL 广告线非 P0，不急）：把 NAL 十月那条（编号以 018b7053 开头）的 recurrence 设成 monthly；回滚：设回 null。
