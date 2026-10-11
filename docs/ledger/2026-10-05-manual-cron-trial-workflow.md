---
id: 2026-10-05-manual-cron-trial-workflow
title: 加一个"当面试跑"入口：开发窗口能手动触发白名单内的定时任务（默认只演练不写入）
status: done
owner: agent
decided_on: 2026-10-05
source: session:cdd5dbf9
verify_by: 2026-10-08
verify_how: 合并后用 `gh workflow run manual-cron-trial.yml -f job=seo-weekly-list -f dry_run=true` 触发一次，运行摘要里有该任务的返回内容；非 main 分支触发会被拒（job 的 if）
done_on: 2026-10-05
done_ref: pr:2234
check_note: 线上只演练已当面跑通，见 evidence/2026-10-05-seo-weekly-list-live-dryrun；定时自动运行待首次运行后核对（2026-10-09 夜巡：本晚未取到新实证，原结论保留不变）
last_checked: 2026-10-11
---
PM 2026-10-05 规矩：先当面试跑再排日历。线上密钥只在仓库 Secrets，由 Actions 带着去调，开发窗口不读生产密钥。改 .github/ 属 A 级。
