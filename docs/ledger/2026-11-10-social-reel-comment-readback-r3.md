---
id: 2026-11-10-social-reel-comment-readback-r3
title: R-3：工厂 Reel T+读数走 video 节点拿 comments.summary
status: decided
owner: agent
decided_on: 2026-11-10
source: pr:3778
verify_by: 2026-11-17
verify_how: 合并后下一批 factory_reel 过 T+4 时，回执 comments 不再是 field_absent 而帖子 reactions 仍有数；对比 Graph 对 bare video id 的手动 GET 应一致。
---
measure 消费端在 action.payload.source=factory_reel 时用 video_id 或从复合 post_id 拆出的 bare id 调现有 fetchPostEngagement；daily_plan 不变。新登记动作补写 payload.video_id。只读 Graph、只写既有测量回执。
