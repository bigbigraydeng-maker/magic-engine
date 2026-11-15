# 证据 · 2026-09-26-seo-site-level-verdicts-unknown · 2026-11-15
fetched_at: 2026-11-15T21:40+13:00
查了什么：生产库 flywheel_outcomes（只读 SELECT）。
数字：①整站 SEO 指标（seo.gsc.clicks/impressions/avg_position、seo.domain.*、seo.ga4.*）computed_at 晚于部署时刻 2026-09-26 03:10:20Z 的行共 1401 条，全部 verdict=inconclusive 且 confidence=0，最近一条 2026-11-15 06:07Z；部署前旧行 51 条（confirmed 19 / reversed 30 / inconclusive 2）最后计算于 2026-08-05，此后未被重算。
②③：SEO 行动里 stored 为已判定(confirmed/reversed)的仅 9 条，metric 全是 seo.gsc.avg_position/clicks/impressions（整站指标）；main 上 src/lib/flywheel/attribution/outcome-identity.ts 的 effectiveVerdict 对整站指标一律返回 inconclusive，所有读取方（flywheel/aggregate、flywheel-history）都走它，且可判定 <3 时 success_rate 为 null → 实际可判定 0，排行里不出现 SEO 行动类型、不给百分比（代码层核对，未登录后台页肉眼看）。
来源/命令：supabase execute_sql（select ... from flywheel_outcomes）；grep effectiveVerdict。
结论：成。整站 SEO 指标不再产生成功/失败结论，数字照留。
