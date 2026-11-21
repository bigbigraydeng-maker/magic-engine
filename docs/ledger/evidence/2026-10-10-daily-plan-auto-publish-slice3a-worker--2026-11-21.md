# 证据 · 2026-10-10-daily-plan-auto-publish-slice3a-worker · 2026-11-21
fetched_at: 2026-11-21T08:04:07+1300
查了什么：生产库 cron_run_logs 里 job_name=daily-plan-auto-publish 的全部运行记录，按新西兰日期分天计数。
数字（带样本量、两边取数状态）：取数成功。累计 826 条，首条 2026-10-12 03:20（新西兰），全部 status=completed、summary 里 authorizations=0、无 error。11-06 到 11-14 每天 24 条（每小时第 20 分钟一条）；11-15 只有 15 条，最后一条 14:20；11-16 到 11-19 零条；11-20 一条（08:20）、11-21 一条（03:20）。同期整个系统其它定时任务每天照常 1700~2000 条，说明不是记录表坏了。代码里排程仍是每小时第 20 分钟（TZ=Pacific/Auckland 20 * * * *）。
来源/命令：Supabase 只读 SQL（cron_run_logs 按 job_name 分组、按新西兰日期 group by）；src/lib/inngest/functions/daily-plan-auto-publish.ts 第 26 行。
结论：不成。定时函数上线后确实注册上了、连跑一个月都正常；但从 11-15 下午起不再每小时跑，现在一天只零星跑一次，达不到卡上「每小时第 20 分钟都有一条成功记录」。原因未查（可能与定时任务平台免费额度有关，未核实）。
