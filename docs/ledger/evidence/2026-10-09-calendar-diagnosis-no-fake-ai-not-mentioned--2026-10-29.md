# 证据 · 2026-10-09-calendar-diagnosis-no-fake-ai-not-mentioned · 2026-10-29
fetched_at: 2026-10-29T21:36:35+1300
查了什么：生产库 diagnostic_findings（dimension=ai_visibility）10/09 起的所有结论，凡 brand_not_mentioned 的核对 evidence 和对应客户 ai_visibility_snapshots 周快照。
数字（带样本量、两边取数状态）：10/09 起 ai_visibility 结论 11 条，其中 brand_not_mentioned 3 条：New Asian Logistics 10-12 08:07Z、East International 10-12 08:14Z、East International 10-19 08:05Z，三条 evidence 字段都是 null（无 live_probe）。周快照：NAL 在该结论之前最新的一份是 week_of 2026-10-05（10-11 18:46Z 写入）total_runs=0、mentions=0——一次都没测成；NAL 前后周都是 54~59 次运行、5 次提及。East 最近快照 week_of 2026-09-28 total_runs=12、mentions=0（0/12，算有效来源）。
来源/命令：Supabase CrazyContent 只读 SQL（diagnostic_findings join clients；ai_visibility_snapshots）
结论：不成。NAL 10-12 那条「AI 里没人提到你」既没有实测，对应周快照是 0 次运行（没测成≠零），属于判据禁止的编造结论。East 两条有 0/12 快照支撑。
