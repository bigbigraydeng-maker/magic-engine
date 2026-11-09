---
id: 2026-09-29-social-publish-gate-risk-accepted
title: 讲课片+两个Publer发布口子权限过松——PM拍板先不动，接受风险
status: decided
owner: pm
decided_on: 2026-09-29
source: session:31cdcfa9
verify_by: 2026-10-13
verify_how: 到期核两件事：①社媒内容治理设计（docs/specs/2026-09-29-social-content-publish-governance-v0.2.md）是否已定稿并开始实施；②这三条口子（讲课片 publish_facebook、publer/create-post、publer/schedule）期间是否发生过一次因权限过松导致的真实发布事故（查 content_work_orders/publer 相关表这两周的记录）。两条都没有进展，本决定连带失败，需要 PM 重新决定。
---
写社媒内容治理设计（起因 East Inter 事故）时查出三条现存发布口子鉴权过松：讲课片发布（`content-factory/[postId]/lecture`，`requireDashboardClientAccess`，客户不用付费即可触发真实公开发布，唯一门槛是字幕对齐）；`publer/create-post`、`publer/schedule`（表面要求 `content_posts.status='approved'`，但设置 approved 的入口 `content-factory/[postId]/route.ts` 同样是 `requireDashboardClientAccess`，能批准的人跟能发布的人是同一批，"审批闸"不构成真保护）。价格声明闸（`judgeOutgoingPost`）不受影响，依然拦得住编价格那一类，仅"能否走到发布"这一步是假的。
PM 2026-09-29 拍板「先不动」：三条口子暂不关闭、不加内部审批，接受这段时间的风险，等社媒内容治理完整设计+实施一次性解决，不为此单独排期或再找 PM。
