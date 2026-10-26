# 证据：SEO 巡查卡收敛两周效果（日历巡检 2026-10-13 取数）

fetched_at: 2026-10-13 (NZDT)，生产库 glbdnayojixmexgofbsd 只读 SELECT

- 件1：9/27 起任一连续 7 天新开巡查卡的不同目标数：ctstours.co.nz 最多 3，oztopbuildingsupplies.com.au 最多 3（≤3，成立）。
- 件2：同一目标被开不止一张卡的目标数 = 0（9/27 起共 14 张巡查卡，样本小）。
- 件3：建了不到 14 天就被顶掉（superseded）的卡 = 0。
- 补充：cron_run_logs seo-patrol-daily 9/27 起 12 条，已完成的 failed_count 合计 0；但 10/06、10/10 各有一条一直停在 running（summary 为空），另 9/30、10/1-10/3 没有运行记录（10/5 日历提醒提到该巡检曾重新开启）。
- 结论：三项主条件成立。两条卡在 running 的运行记录是异常，需开发窗口看一眼。
