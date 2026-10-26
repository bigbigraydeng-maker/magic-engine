---
id: 2026-10-26-factory-worker-sweeper-on-dispatcher
title: 出片卡住的自动收回改挂到现有的每 5 分钟调度，不再靠 GitHub 准点，也不新开一台服务器任务
status: decided
owner: agent
decided_on: 2026-10-26
source: pr:3070
verify_by: 2026-10-28
verify_how: 合并并让网站部署这版之后，看每 5 分钟那次调度的运行记录里出现 factory-worker-sweeper 且成功；GitHub 工作流 factory-sweepers 不再有定时触发。部署前不要打线上接口。
---
出片工单心跳超过 10 分钟还停在领取中或制作中，改由已经在跑的每 5 分钟调度去打原来的接口，退回排队。
不新开服务器，也不新开定时服务。GitHub 上这条不再按点自动跑，手动运行还留着。
电脑合上盖只是心跳停了，收回不靠那台电脑开着。
这次不能对着线上工单试跑，一打就会改真实工单。部署前收回仍靠 GitHub，间隔仍可能是几小时。
这条替代已关闭的 #3070。那张是新开一台定时任务，这张改挂到现有调度上。
