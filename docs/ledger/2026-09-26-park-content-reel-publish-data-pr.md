---
id: 2026-09-26-park-content-reel-publish-data-pr
title: 搁置 PR content-reel-publish-data（P21.J M1 数据地基）——欠 PR-B/PR-C 几周活，跟周末冲刺意图不匹配，走轻量路径修工作包 B
status: decided
owner: pm
decided_on: 2026-09-26
source: session:bf0cd6eb
verify_by: 2026-12-01
verify_how: 上面那个 PR 保持 OPEN 不合并；spec v2 §14 相关的 PR-B（旧入口防护）和 PR-C（Inngest 编排）出现时重新评估；届时如果真需要客户级公开发 Reel 开关+发布记录状态机的数据地基，回来一起合；否则 12-01 之后确认是否长期搁置
---
搁置理由（小秘书按 CLAUDE.md §2 技术决策自决，非 PM 直接拍板）：PR body 自己写"PR-A 零业务调用方"，只是数据库地基，等 PR-B（改 /api/posts/batch 旧入口防护）+ PR-C（Inngest 编排调用）才用得上；光合它没立即效果，还留下几周债。工作包 B（发布前分镜自检硬闸）走轻量路径改现有 `src/lib/factory/review-apply.ts::applyApprove`，不依赖这个 PR。这个 PR 本身的 mutation 测试 42 条全部 KILLED、DB security invariants 全绿、149 条 SQL 探针全过——数据地基质量高，只是时机不对。以后真需要那块地基做客户级公开发 Reel 开关时再回来。
