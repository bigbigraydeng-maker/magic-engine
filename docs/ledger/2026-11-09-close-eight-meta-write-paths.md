---
id: 2026-11-09-close-eight-meta-write-paths
title: 八个绕过确认卡的广告写入入口已改成出卡或拒绝
status: decided
owner: agent
decided_on: 2026-11-09
source: doc:docs/audits/2026-11-08-a3-meta-write-paths.md
verify_by: 2026-11-16
verify_how: 跑确认卡回归测试。八个入口在没有未过期确认卡时不得写广告平台。加预算的入口直接拒绝。成片验收不得上传。
---
暂停草稿、房源草稿、止损、降预算、自动暂停和盯盘只暂停，都只出已有确认卡。
成绩单加预算和机会加预算直接拒绝。在投计划要加预算，得新开一份计划。
成片验收不再把视频传到广告账户，因为没有现成的上传确认卡。
没有新表，没有改权限边界，没有调用广告平台。
