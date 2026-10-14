---
id: 2026-10-14-goal-recurrence-column-apply
title: 目标表的「每月自动续建」列已加；还差把 NAL 十月目标标成每月续建（改现有数据，等 PM 回「标记」）
status: decided
owner: pm
decided_on: 2026-10-14
source: pr:2428
verify_by: 2026-10-17
verify_how: PM 回「标记」后：把 NAL 十月那条（2026-10-01~10-31）recurrence 设成 monthly；带密钥访问 goals-expiry-check?dry_run=1，应 200 且 planned 为 0、skipped_existing 为 1（十月已有，不重复建）；真跑一次后十月仍只有 1 条。11-01 之后应自动出现十一月那条（目标仍 300）。
---
2026-10-15 已加列（可空，现有 32 条目标一条未改，非空行 0），同名索引已建；线上试跑 dry_run=1 返回 200、无报错，但因为还没有任何目标被标成每月续建，planned=0，所以「不重复建」还没被证明。
回滚加列：drop index if exists uniq_goals_monthly_per_client_metric_month; alter table goals drop column if exists recurrence;
下一步（改现有数据，需 PM）：update goals set recurrence='monthly' where id in (NAL 十月那条 编号以 018b7053 开头)；回滚：把它设回 null。
