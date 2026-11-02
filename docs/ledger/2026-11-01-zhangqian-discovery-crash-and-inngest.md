---
id: 2026-11-01-zhangqian-discovery-crash-and-inngest
title: 张骞发现页缺字段就整页崩的问题修好；新西兰客户按新西兰查关键词；刷新不再重复开跑；张骞改走后台排队（Inngest）
status: decided
owner: agent
decided_on: 2026-11-01
source: session:c85d5a1f
verify_by: 2026-11-05
verify_how: 合并上线后，在 Inngest 后台确认 cloud-zhangqian-discovery 已登记；用一个测试客户点「开始发现」，看到任务从排队跑到完成、报告页能打开；跑的途中刷新页面应接上同一个任务，不会再扣一次点数；Warm Voyage 的张骞页能正常打开
---
A 级（碰扣费退款和后台任务）。代码已提交到分支，等 PM 回「合」。
新的后台排队方式合并前没有在真实环境当场试跑，合并后第一次跑就是验证。
