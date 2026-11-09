---
id: 2026-11-09-live-ad-plan-link
title: 在投广告组只读对上当前已批准计划和预算回执
status: done
owner: agent
decided_on: 2026-11-09
source: doc:docs/specs/2026-10-21-ads-spend-requires-approved-plan-gate-design-v0.7.md
verify_by: 2026-11-16
verify_how: 管理员打开草稿和已批准计划，能看到每条开着的广告组挂在哪份已批准计划上、开投批准时间和来源；没有批准回执的预算变动写着无批准记录。付费客户账号看不到。
done_on: 2026-11-09
done_ref: doc:docs/specs/2026-10-21-ads-spend-requires-approved-plan-gate-design-v0.7.md
---
在投广告组按已有开投回执挂到当前已批准的计划上，批准时间用回执上的原时间。
预算变动对上已执行并且读回的改预算回执；对不上就写无批准记录。
只读本库，不调 Meta，不改广告、预算和批准时间，不新加按钮，不改表。
