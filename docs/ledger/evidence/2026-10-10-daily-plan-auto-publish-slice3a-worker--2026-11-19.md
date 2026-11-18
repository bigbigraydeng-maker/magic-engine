# 证据 · 2026-10-10-daily-plan-auto-publish-slice3a-worker · 2026-11-19
fetched_at: 2026-11-19T06:19:24+13:00
查了什么：生产库 cron_run_logs 里 job_name=daily-plan-auto-publish 的运行记录。
数字（带样本量、两边取数状态）：共 824 条，首条 2026-10-11 14:20 UTC，末条 2026-11-15 01:20 UTC；按新西兰时间的分钟分布：第 20 分 823 条、第 42 分 1 条；状态 completed + 1 条 failed（11-03 09:20 UTC「abandoned: still running past 2× expected duration」，进程重启）；authorizations 非 0 的 0 条；最新 summary {"records":[],"authorizations":0}。取数成功。
来源/命令：Supabase 只读 SQL（项目 glbdnayojixmexgofbsd）。
结论：成——定时函数注册上了，35 天里每小时第 20 分有成功记录、authorizations=0。注：11-15 01:20 UTC 之后没再跑，同一时刻多个每小时/每日任务一起停，对应已知的 Inngest 额度用完（台账卡 2026-11-16-inngest-quota-relief-direct-fallback），不是这张卡的问题。
