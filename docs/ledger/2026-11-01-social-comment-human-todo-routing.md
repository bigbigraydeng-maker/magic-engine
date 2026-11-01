---
id: 2026-11-01-social-comment-human-todo-routing
title: 主页评论要人回进今日待办（读时分流，不改自动回复）
status: done
owner: agent
decided_on: 2026-11-01
source: pr:3482
verify_by: 2026-11-08
verify_how: PR 3482 合并后第一个工作日：有待处理 needs_human 评论的客户应出现 comment_needs_human_reply 待办（href 绝对网址）；本路径只覆盖 needs_human=true 且 reviewed_by 为空的行
done_on: 2026-11-01
done_ref: pr:3482
---
flow-plan 第 9 步「只分流」：关键词路由 + 今日待办三件套，不动 comment-autoreply 发送链。
当场试跑：2026-11-01 UTC 本地 Vitest（comment-routing / comment-human-items / five-kinds）；未连生产库。
台账卡 id 供 PR「当场试跑」引用：2026-11-01-social-comment-human-todo-routing。
