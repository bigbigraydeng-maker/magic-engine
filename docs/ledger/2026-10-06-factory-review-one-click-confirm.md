---
id: 2026-10-06-factory-review-one-click-confirm
title: 审核页「通过·待发布」改成点一次确认；口吻提醒可「PM 已接受」（A 级，草稿 PR 待两位审查）
status: done
owner: agent
decided_on: 2026-10-06
done_on: 2026-10-06
done_ref: pr:2319
source: session:619710c8
verify_by: 2026-10-13
verify_how: 两位不同审查（狄仁杰审已接受白名单/指纹作废/授权记录；子牙或魏征审一键不会被绕过）通过 + PM 同意后合并，并在生产库应用建表脚本；PM 在看板点一次真实待审片，确认能一次通过
last_checked: 2026-11-12
check_note: 11-12 查：PR 2319 已于 10-06 合并；生产库表 factory_review_flag_acceptances 已存在但 0 行（从没有人点过 PM 已接受）。判据要 PM 实点一次真实待审片，没有真实使用记录，判不了
---
设计见 docs/specs/2026-10-06-factory-review-checklist-simplify-design.md（统筹已通过一期）。本卡随草稿 PR 一起开；合并后改 done 并补 done_ref。建表脚本未在生产库应用，须 PM 批准。
