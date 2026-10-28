---
id: 2026-10-29-crm-enquiry-screen-wp-a-revive-rollback
title: 有效咨询筛选第一包：被机器判成非咨询的人再来信自动放回名单 + 一键回退脚本 + 回退过的人永久不再判
status: decided
owner: agent
decided_on: 2026-10-29
source: session:96dc6edf
verify_by: 2026-10-31
verify_how: 合并后看每小时任务的运行回执里有 enquiryRevive 字段（没人被机器判过时应是 candidates 0、revived 0、没有 error）；本地跑 scripts/crm-enquiry-screen-rollback.ts 演练应只说「将还原 0 人」
---
魏征审设计稿时查出两个前提缺失：判走的人再来真咨询不会回名单、回退脚本不存在。本卡补这两处，运行器（第二包）在它们完成之前不许打开。
做法：每小时任务里加一段，只放回「最近一次阶段变更是机器筛选判的」且判走之后又来了真消息的人（人标的不碰，自动回复/打开点击/未接来电不算）；回退脚本默认只演练；回退过的人永久不再被筛选。
当场试跑：本机没有生产密钥权限，未能手动触发整条链路；单元测试 15 条含 5 个变异检验全部抓得到；上线后首轮每小时任务回执核对。
