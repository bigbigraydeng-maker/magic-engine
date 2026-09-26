# 证据：CTS 9 月 Magic Bridge 免费额度退还（2026-09-26 03:09 UTC 执行）

- 授权：PM 在卫青窗口回「退」（2026-09-26）；方案 `docs/specs/2026-09-26-magic-bridge-sept-refund-plan.md`
- 执行前核对（只读）：`meta_ads_ai_sponsored_budgets` CTS / 2026-09：cap 1.250000 · reserved 0.000000 · spent 1.042714；任务表 12 条合计 1.042714（与方案一致）
- 执行：带守卫的 UPDATE（spent_usd = 1.042714 且 reserved_usd = 0 时才改），返回 1 行：spent_usd 0.082714 · reserved 0 · cap 1.25 · updated_at 2026-09-26 03:09:11 UTC
- 回读：available = 1.167286（约可再生成 9 份，按每份预留 $0.12）
- 未改：`meta_ads_ai_analysis_jobs` 各条扣费记录（保留审计痕迹）
- 回滚语句见方案第 4 节
