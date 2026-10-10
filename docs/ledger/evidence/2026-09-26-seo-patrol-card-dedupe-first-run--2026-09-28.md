# 证据 · 2026-09-26-seo-patrol-card-dedupe-first-run · 2026-09-28

fetched_at: 2026-09-28T09:40:00Z

查了什么：cron_run_logs job_name=seo-patrol-daily 2026-09-27 04:01-04:06 UTC（合并后第一次运行）；
execution_items 该窗口内 dimension=seo source=zhuge 新建/superseded 的行

数字：
- 运行状态：status=completed，failed_count=0
- 该窗口内新建的巡查卡：CTS 只有 1 张（Refresh Blog / rule_id=not_indexed，目标页
  china-icons-collection-christchurch——这正是卡里点名要另记一句的 Christchurch 页，当天确实开出了第一张卡）；
  Oztop 0 张新卡（本周名额用完，跟卡上预期一致）；china-tours-from-australia 这个目标没有出现新卡
- 该窗口内被标 superseded 的卡：2 张，创建于 2026-09-13、建卡龄精确 14.0005 天，没有建了不到 14 天就被顶掉的

来源/命令：Supabase cron_run_logs + execution_items 只读查询

结论：成。三项判据全部满足，且卡里额外想确认的"Christchurch 页当天是否开出第一张卡"也确认为是。
