---
id: 2026-11-04-social-weekly-loop-p7-maliang-backfill
title: 社媒每周闭环 P7：马良补审接进每周编排（单客户每周花费上限，演练不花钱）
status: decided
owner: pm
decided_on: 2026-11-04
source: pr:3571
verify_by: 2026-11-18
verify_how: 写库开关打开后的第一个出稿日，cron_run_logs 里 CTS 的 social-weekly-draft 回执 summary.maliang_backfill 有 reviewed 记录且 spent_usd ≤ cap_usd；被补审的工单 output.maliang_check.check_version = v2；同周回执 spent_usd 累计不超过 0.5 美元
---
设计 v1.1 §2.4a：每周编排先空跑一遍，挑「只差马良没审、事实已核过」的片调马良 v2（每条一个步骤、不重试、180 秒超时），写库模式带 updated_at 条件写回 output.maliang_check；演练模式只报要补几条，手动事件带 maliang_review: true 才真审且只在内存叠加。单客户每周上限 weekly_loop.maliang_weekly_cap_usd（缺省 0.5、最多 5 美元），每次最多 6 条，已花金额读近 7 天回执，读不到就不审并记失败。不发布、不写人工审片清单。
