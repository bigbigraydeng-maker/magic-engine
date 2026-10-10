---
id: 2026-10-08-daily-plan-first-comment-parts
title: 每日计划首评功能第一步：共用的「首评写入器」和纯函数零件，不改任何运行中行为
status: decided
owner: agent
decided_on: 2026-10-08
source: session:cf1e84bd
verify_by: 2026-10-15
verify_how: 合并后视频发布仍正常发首评（Reel 行为不变）；零件的测试全绿；接线 PR（审核、发布、补发、待办）另开，授权补齐后才能真发
---
设计见 docs/specs/2026-10-08-daily-plan-first-comment.md。首评写入器从视频发布里抽出共用，评论超过 5 页扫不完时改为不发布（宁可不发也不重复）。
CTS 的 Meta 授权已于 10-08 补齐评论权限（只读探针 4 项均为已授权）。
