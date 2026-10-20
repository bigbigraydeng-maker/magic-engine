---
id: 2026-10-21-review-route-writes-approval-source-marker
title: ME 审核页和 Airtable 同步在批准成片时，往工单审核记录里写「这条批准是哪条路径写的」的标记，好让广告请求回执台账只认「内部员工在审核页批的」
status: decided
owner: agent
decided_on: 2026-10-21
source: session:1f83deb6
verify_by: 2026-10-28
verify_how: 合并部署之后，读生产库 content_work_orders 里批准时间晚于部署的工单，review_ref 里 approval_source 都有值（审核页批的 = me_review_route，Airtable 同步批的 = airtable_sync），内部员工账号批的 approver_scope = internal_staff；样本至少 1 条经审核页批准的工单，期间没有新批准的工单就顺延，不算失败。
---
台账设计稿 v0.9 的 §4「批准人从哪来」和 §10 ②''：台账只认「ME 审核页由内部员工批准」的成片，所以审核页和 Airtable 同步两条批准路径要各写各的来源标记（改动很小，是 W1a 的前置）。
改动：review-apply.ts 的 applyApprove 多一个可选标记参数；审核路由用 requireGlobalAdmin 判 internal_staff 还是 scoped_admin 再传进去；Airtable 同步写 airtable_sync + unverified，永不写路由那个值；调用方不传标记就不写，旧标记也会被清掉（宁可台账拒收）。
不做：不改 $50 花钱闸、清单校验和只有素材不许发布的拦截；不动台账函数和迁移（那是后续的 PR）；在台账上线前这些标记没有任何读取方，不影响现有审核流程。
