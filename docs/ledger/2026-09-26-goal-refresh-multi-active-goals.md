---
id: 2026-09-26-goal-refresh-multi-active-goals
title: 一个客户同时有多个进行中目标时，每天自动刷新目标当前值全部失败；修成按每个目标自己的时间段取数，失败原因写进运行记录
status: verified
owner: agent
decided_on: 2026-09-26
source: session:01f0fb96
verify_by: 2026-09-28
verify_how: 上线后第一次每日刷新跑完，CTS 那条留资目标的当前值有数字（接近广告留资期内合计），且运行记录里失败的目标带原因、状态不再是全绿
done_on: 2026-09-26
done_ref: pr:2038
last_checked: 2026-10-14
check_note: CTS 3 个进行中目标在 10-13 17:31 UTC 那轮各按自己周期刷出了数：留资 19、自然搜索点击 1033，来源都是 auto.cron；运行记录 processed=3/completed=2/failed=0，没完成的那个报名目标在 summary.no_data 里带中文原因（回查确认就是 signups_count 那条）——状态不再全绿、原因不再只打控制台
verified_ref: doc:docs/ledger/evidence/2026-09-26-goal-refresh-multi-active-goals--2026-10-14.md
---
根因：取时间段时假设一个客户只有一个进行中目标，CTS 从 9-24 起有两个，两条都刷不出来。
另一半：定时任务把失败原因只打在控制台，运行记录显示 completed、原因为空，健康页看不出。
报名数目标如果库里还没有成交记录，仍然会显示"未判"并带原因——这是既有设计，不是没修好。
实现 PR：pr:2038（已合并），done_ref 保持指向它作为完成证据。
