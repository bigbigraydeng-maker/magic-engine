---
id: 2026-10-21-factory-review-route-scoped-admin-can-approve-other-clients
title: ME 审核页的「通过」没限定客户，限定单个客户的演示管理员可以批别家客户的成片，批完发布任务会照常发出去
status: decided
owner: agent
decided_on: 2026-10-21
source: session:1f83deb6
verify_by: 2026-11-04
verify_how: 读代码确认审核路由 approve 对限定单个客户的管理员把他自己的客户 id 传给 applyApprove（别家客户的工单返回 403）并有测试；或者 PM 明确决定不收紧，把原因写进卡里再改 failed。
---
独立审查（10-21，审核页来源标记的小改动）读代码发现：审核路由调 applyApprove 时客户 id 传的是 undefined，所以环境变量 DEMO_ADMINS 里「只能看客户 X」的管理员也能批客户 Y 的工单，批完发布任务会照常把片子发出去。
台账设计稿 §12(e) 早就知道这一点并留作「不在本稿范围」；来源标记（approver_scope = scoped_admin）只能事后在台账里记下，拦不住片子发出去。
建议修法很小：限定客户的管理员批准时，把他自己的客户 id 传给 applyApprove（loadInReview 已有跨客户 403 的检查）；要不要收紧、收紧到什么程度是产品决定，会影响演示账号现在能做什么。
这个 PR 不做；演示管理员现在有几个、谁在用，没有核实。
