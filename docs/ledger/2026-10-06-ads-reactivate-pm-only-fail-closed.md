---
id: 2026-10-06-ads-reactivate-pm-only-fail-closed
title: 重新开启广告改成只有 PM 能点，开之前先留记录；暂停不受影响；无人调用的「一键推广」代码已删
status: verified
owner: pm
decided_on: 2026-10-06
source: session:a0f2e1de
verify_by: 2026-10-13
verify_how: 看 A 级草稿 PR 是否已由 PM 回「合」并合并；卫青+狄仁杰两审的发现是否都已修；合并后用假 Meta 再跑一遍两入口测试
done_on: 2026-10-06
done_ref: commit:e0c1440d7
last_checked: 2026-11-08
check_note: 改动单 2310 已于 10-06 合并进主干；今晚在当前主干重跑它的 6 个测试文件（假 Meta）162 条全过；两审已修以改动单正文为准
verified_ref: doc:docs/ledger/evidence/2026-10-06-ads-reactivate-pm-only-fail-closed--2026-11-08.md
---
两个重开入口（系列「恢复」、草案「批准」）现在只认全局管理员，校验读失败一律拒绝，开之前先把谁/哪个客户/哪个系列/时间写进账本，写不进去就不调用 Meta。
没动：日预算上限那一列（改生产库，等 PM 另批）。分支 feat/ads-reactivate-fail-closed，PR 保持草稿、风险级别 A。
