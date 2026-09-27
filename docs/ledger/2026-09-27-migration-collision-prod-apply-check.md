---
id: 2026-09-27-migration-collision-prod-apply-check
title: 三组撞了版本号的数据库变更，核对它们在正式数据库上是不是都真的生效了（需要 PM 给一次生产只读权限）
status: decided
owner: pm
decided_on: 2026-09-27
source: session:d1add426
verify_by: 2026-10-04
verify_how: 用生产只读权限逐个核对这 6 个 migration 文件的效果在正式数据库上都在：messenger_agent_email_kill_switch、seo_meta_cycle_v1、fix_seo_patrol_findings_grants、playbook_staleness_findings、client_lead_sheet_routes、kernel_recovery_outside_autonomy_envelope；每个都要能指出正式库里对应的表、列、函数或授权已经是文件里写的样子才算成；任何一个不是 = 不成（漏上了，交 PM 决定补上）
---
PR 2079 把这三组撞号补登进豁免清单，没有改号。撞号本身不会弄坏正式库的变更记录（apply_migration 按执行时间记版本号），真正的风险是其中有哪一个漏上了。
其中 fix_seo_patrol_findings_grants 是收回权限的修复，漏上 = 权限还开着；9/26 广告 D3 刚出过一次漏上的事故。
