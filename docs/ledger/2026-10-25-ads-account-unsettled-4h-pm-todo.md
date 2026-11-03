---
id: 2026-10-25-ads-account-unsettled-4h-pm-todo
title: 广告账户欠款（状态码 3）一读到就进 PM 今日待办，隐藏账户照样出；状态读取最坏延迟由约 6 小时缩到约 2 小时
status: decided
owner: pm
decided_on: 2026-10-25
source: issue:3125
verify_by: 2026-10-28
verify_how: 合并后手动触发一次 meta-leads-sync，看 cron_run_logs.summary.accountStatusProbe（accounts>0、failed=0）；CTS 旧账户仍欠款时，今日待办应有「账户状态不是正常」一条，且带「隐藏…马上暂停」。
---
起因：CTS 旧账户 10-11 起欠款停投 14 天，待办要等 24 小时保持期，状态又 6 小时才读一次，隐藏账户的钱风险也没人提（issue #3125 §8）。
改法：欠款码 3 去掉 24 小时保持期（其它码不变）；隐藏账户待办多一句还款后要马上暂停；挂在已有每 2 小时线索同步上只读探测账户状态、只写账户级快照；追踪检查「账户与付款」黄灯且其它账户有在投预算时下发待办。
B 级，无 migration，未改 render.yaml 和受保护路径；测试合并前需 CI 跑。
