---
id: 2026-11-03-ads-knife3a-spend-gate-pm-only
title: 广告加钱类动作（加预算、挪预算、新建再营销组）只有 PM 本人能批，不管客户设置是不是自动；重开暂停的广告也只认 PM 本人
status: done
owner: agent
decided_on: 2026-11-03
source: session:f765a75f
verify_by: 2026-11-06
verify_how: 合并部署后读 client_automation_policies，CTS 和 NAL 的 ads.scale_unit_budget / ads.budget_move_plan / ads.add_retargeting_adset 三条都是 require_approval（版本号比 11-03 的 CTS v3、NAL v1 各加 1）；Render 上 ADS_SPEND_APPROVER_EMAILS 只有 PM 本人一个邮箱；其余广告动作的策略行版本号没变
done_on: 2026-11-03
done_ref: pr:3567
---
PM 11-03 回「只有 1」：名单只放 PM 本人 gmail，ADMIN_EMAILS 另外 5 个邮箱以后只能暂停和减预算。上线确认卡开新系列本单没动，已问 PM 要不要也收紧。
设计稿 docs/specs/2026-11-03-ads-knife3-spend-gate-and-budget-buttons-design.md（§9 记了实现与设计的差异）。3b（成绩单调预算按钮）在本单合并部署后开工。
