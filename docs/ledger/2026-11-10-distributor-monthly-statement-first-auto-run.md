---
id: 2026-11-10-distributor-monthly-statement-first-auto-run
title: 经销商月结第一次自动运行（12 月 1 日 09:00 新西兰时间，算 11 月）要核：跑了、记账对、没付钱
status: decided
owner: pm
decided_on: 2026-11-10
source: session:e5aca2ac
verify_by: 2026-12-01
verify_how: 查 cron_run_logs 里 job_name=distributor-monthly-statement 在 12-01 有一行。表已上线时 summary.status=computed 且 no_payout=true，distributor_statements 有一行 2026-11-01、状态 computed；表没上线时 summary.status=skipped_tables_missing 也算正常。没有这一行就是没跑。
---
本地临时库已当场试跑两个月（10 月正常发、11 月退款倒扣和欠款结转、重复生成会跳过、数据库三道拦截），正式环境还没跑过：数据库表要等 Ray 亲手合并并让它生效。
新函数部署后要去 Inngest 后台 Sync 一次，否则安静地不跑。
没跑成时第一步：看 Render 部署里有没有这个函数、Inngest 后台有没有 Sync，再看运行记录里的 error。
