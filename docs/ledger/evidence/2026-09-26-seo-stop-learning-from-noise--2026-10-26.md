# 证据 · 2026-09-26-seo-stop-learning-from-noise · 2026-10-26
fetched_at: 2026-10-26T21:35:08+1300
查了什么：生产库 client_proven_patterns / client_failed_experiments 里 source_table=flywheel_outcomes 的行按支柱和 is_active 分组；cron_run_logs 里 memory-extractor 2026-09-26 ~ 10-04 每次运行的 summary.deactivated 清单。
数字（带样本量、两边取数状态）：
- client_proven_patterns（来自 flywheel_outcomes 共 161 行）：seo 112 行全部 is_active=false；ads 6 行全部 false；geo 43 行全部 true。
- client_failed_experiments（共 129 行）：seo 89 行全部 false；ads 5 行全部 false；ai_visibility 33 行 true、2 行 false。
- 1b 上线后第一次运行 2026-09-27T06:30:57Z：deactivated 清单 213 条，每条带 id + table + reason（no_execution_evidence 165 / site_level_metric 28 / source_missing 16 / preference_no_support 4）；按表：proven 117、failed 92、learned_preferences 4。清单里的 proven/failed 行逐条对回生产库：全是 seo 或 ads、当前均为 false；清单里 AI 可见度行 0 条。其余各晚 deactivated 均为空。
- 旁注：那 2 条 ai_visibility 停用行不在 9-27 清单里，updated_at=2026-09-28T06:31，当晚运行 deactivated=[]，是别的路径改的，不是本次下架。
两边取数状态：两张表与运行记录都正常返回，无报错。
来源/命令：Supabase REST 只读 GET（service role，主仓库 .env.local）。
结论：成。①SEO/广告来自效果记录的旧经验全部停用；②清单没碰 AI 可见度/社媒任何一行；③第一次运行记录了 213 条 id+表名，可按清单恢复。
