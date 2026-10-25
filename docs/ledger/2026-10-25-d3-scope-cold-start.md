---
id: 2026-10-25-d3-scope-cold-start
title: D3「花钱没结果」纳入类似人群组和流量组（只提醒、不进自动暂停）；历史不满 14 天按目标 2 倍判；D3 进 PM 今日待办
status: done
owner: agent
decided_on: 2026-10-25
source: issue:3125
verify_by: 2026-11-01
verify_how: 合并后跑一次 CTS 当日诊断：官方账户 WA 拉新组 / 官网点击组应出 D3「只提醒」；`ad_health_narratives` 不再写「数据积累中」；flywheel_actions 里这些组不应出现 ads.auto_pause_on_d3 记录
---
范围：诊断层加两类候选并带 `autoPauseEligible:false`，自动暂停消费端只认原来的获客/再营销；冷启动判定读客户目标成本，没配不判（红线 7）。
D3 进 PM 待办（连着 2 天命中才出），客户侧共享的 ADS_RULE_CODES 没动，D3 不进客户报告。
无 migration、未改 render.yaml、未碰 Kernel。测试已写，本环境能否运行见 PR 说明。
