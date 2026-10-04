---
id: 2026-10-04-seo-rank-sampler-deployed-and-synced
title: 排名验收的代码上线后，每日采样函数要真的被 Inngest 认到并按时跑起来
status: done
owner: agent
decided_on: 2026-10-04
done_on: 2026-10-04
done_ref: pr:2216
source: session:06ec010d
verify_by: 2026-10-07
verify_how: "①合并并部署后对 /api/inngest 做一次 Sync：PUT 返回 Successfully registered 且 modified:true（更正：原写「function_count 前后差 +2」不成立——GET 的 function_count 反映的是已部署的代码，部署后即为 57，Sync 不改它）；②cron_run_logs 里 job_name=seo-meta-rank-sampler 从 10/5 起每天 20:20 UTC 有一行 completed（前 18 天没有到期的改动，processed=0 是正常的，但这一行必须有）；③10/5 周一改标题那一轮之后，seo_meta_log 里新增的行都带 baseline_rank_status；若某行是 fetch_failed，周报里「记下了改动前排名」的数字要比「改了」少。三项都满足算成。"
---
排名采样两个函数（cloud-seo-meta-rank-sampler-fanout / -one）是新增的。Inngest 的坑：新增函数部署后没人点 Sync，它会安静地不跑，样子和「一切正常」一模一样。
本卡只验「函数被认到、按时醒来、基线被记下」；真正的排名结论要等改动满 18 天、连查三次，见 2026-10-04-seo-title-rank-verification。
健康检查登记（把这两条链放进「没跑会喊」的名单）在单独的 A 级小包 pr:2217 里。
已做：#2216 于 2026-10-04 07:38 UTC 合并；crazycontent 部署 live（07:41）；对 /api/inngest 做了 PUT Sync，返回 Successfully registered / modified:true。
