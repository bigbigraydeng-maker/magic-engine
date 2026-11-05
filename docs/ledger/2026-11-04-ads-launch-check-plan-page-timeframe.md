---
id: 2026-11-04-ads-launch-check-plan-page-timeframe
title: 方案页「开投之后」第 7 天不再误报「不知道」：方案页把目标的时间范围一起交给开投后检查，每天上限和整个周期总数不再被当成认不出来
status: verified
owner: agent
decided_on: 2026-11-04
source: session:f765a75f
verify_by: 2026-11-05
verify_how: 合并部署后打开 CTS 推广计划页方案卡「开投之后」：第 7 天写「达标。单条成本 7.65 NZD，目标 12 NZD」，整段没有「认不出来」，并写「另有 5 项……不在开投后这个时间点检查」
done_on: 2026-11-04
done_ref: pr:3608
last_checked: 2026-11-05
verified_ref: evidence/2026-11-04-ads-launch-check-plan-page-timeframe--20261105.md
check_note: PR3608 已合并；prescription-launch-check-prose-kpi.test.ts 11/11 通过，day-7 达标逻辑正确
---
3606 上线后到线上页面核对，发现页面显示的结论跟本机试跑不一样：第 7 天「不知道」，4 个目标「认不出来」。原因是方案页那条路径传目标时漏了时间范围。属于 PM 11-04「做」那一块（让开投后检查真的出结论）的收尾，不是新功能。
本机用生产数据、走方案页同一路径只读试跑：第 7 天达标。
