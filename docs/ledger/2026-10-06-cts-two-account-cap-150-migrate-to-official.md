---
id: 2026-10-06-cts-two-account-cap-150-migrate-to-official
title: PM 定 CTS 个人户与官方户每日预算合计不超过 150、广告逐步迁到官方户；生产库两户上限已改为 120 和 30 并经 PM 确认
status: done
owner: pm
decided_on: 2026-10-06
done_on: 2026-10-06
done_ref: doc:docs/audits/2026-10-06-prod-ad-account-cap-column-and-values.md
source: session:ec90bb17
verify_by: 2026-10-13
verify_how: 生产库只读查 CTS 两户上限为 120 与 30 且合计 150；迁移计划的阶梯表每一步都不超过这两个上限。
last_checked: 2026-11-11
check_note: 11-11：只读查生产库client_meta_ad_accounts，CTS两户上限现为20000与1(分)，不是120/30(12000/3000)，合计不是150；10-06后已被改过，原判据不成立但不确定是有意调整，不翻状态，交PM确认当前上限
---
PM 原话：两户合计每天不可超过 150，逐步把广告从个人户挪到官方户。PM 随后对 19 号窗口回「120/30」确认起点。
执行记录、账户对应关系说明、读回值、回滚办法见 done_ref 指向的审计文档；迁移计划另在迁移计划 PR 里。
