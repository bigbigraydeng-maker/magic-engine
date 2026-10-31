---
id: 2026-10-26-ads-facts-live-delivering-budget
title: 广告预算事实层的「在投合计」来自实体快照，会漏掉上一轮抓取之后才新开的广告；要改成实时读（本版只加过期闸，不改取数层）
status: decided
owner: agent
decided_on: 2026-10-26
source: pr:3193
verify_by: 2026-11-16
verify_how: 把 loadAdsDraftFacts 的在投预算改成实时读：复用心跳读取层 readHeartbeatAccount（≤4 次 Graph 调用/账户）读 ACTIVE 广告组日预算，或在快照基础上补加「抓取之后 ME 自己新建并点开的广告」。核对方式：开一条新广告后立刻跑预算建议，应已计入它的日预算（今天实测 7274 的 50 美元/天在最新一轮抓取之后才开，读数仍是 0）。到期前确认已改或续期。过期闸（快照老于 12 小时→日预算保守减半）在处方转计划草稿第一刀里先上。
---
2026-10-26 开工前只读读数发现。抓取节奏每 6 小时（30 */6 * * *）；实体行 captured_at 只在设置变化时+每日一行才写，不能当“最近一次抓取时间”，要读 ad_snapshot_captures。
