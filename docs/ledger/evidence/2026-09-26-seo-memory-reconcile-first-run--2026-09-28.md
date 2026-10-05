# 证据 · 2026-09-26-seo-memory-reconcile-first-run · 2026-09-28

fetched_at: 2026-09-28T09:30:00Z

查了什么：cron_run_logs job_name=memory-extractor 2026-09-27 06:30 UTC 那次运行的 summary；
client_proven_patterns / client_failed_experiments / client_learned_preferences 里 updated_at=2026-09-27
且 is_active=false 的行按 flywheel/dimension 分组计数

数字：
- 运行状态：status=completed，failed_count=0
- 关闭条数按原因：source_missing 16、site_level_metric 28、no_execution_evidence 165、
  preference_no_support 4——只出现这 4 类允许的原因，没有意外原因
- 按支柱拆分（updated_at=2026-09-27 的关闭行）：SEO 有效经验(proven_patterns) 112、SEO 失败经验
  (failed_experiments) 89、SEO 偏好 4、广告有效 5、广告失败 3 —— 跟卡上写的生产只读估算
  「SEO 112/89/4、广告 5/3」逐个数字精确对上
  AI 可见度（geo/ai_visibility）与社媒：0 行被关闭

来源/命令：Supabase cron_run_logs + 三张经验表只读查询

结论：成。三项判据全部精确匹配：运行成功、关闭数字与预估分毫不差、AI 可见度与社媒一条没动。
