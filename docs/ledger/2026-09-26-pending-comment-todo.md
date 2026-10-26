---
id: 2026-09-26-pending-comment-todo
title: 工作包 D · 卡住的评论（needs_human=true）接进今日待办，等 #1707 合完看剩多少活
status: decided
owner: agent
decided_on: 2026-09-26
source: session:bf0cd6eb
verify_by: 2026-10-20
verify_how: #1707 合入主干后（`social_comment_engagements` 表 `needs_human=true / reply_status='pending'` 的行有 pm-todo 出口）判定剩余工作量——如果 `comment_engagement_scope_missing` 待办已经引到能看到每条 pending 评论、且 FDE 有单条操作入口，标 verified done_ref 指向 #1707；否则新开 PR 补"单条 pending 评论进卡"，工作量 1-2 小时
---
工作包 D：把 social_comment_engagements 里 pending / needs_human=true 的行接进今日待办"🙋 需要你动手"栏。**关键**：PR #1707 已经把这件事做完一大半——body 里说的三个新待办类型（`comment_engagement_scope_missing` / `comment_scan_failed` / `comment_source_refused`）已经下发。合完看剩多少活，可能只需补"单条 pending 评论进卡"。风险 C（只加 pm-todo 判据，不改令牌不外发）；§11 频率中 / IMPACT 中（Act 段漏水）/ 收入低（评论不回不直接掉客户）→ P2。分支 feat/pending-comment-todo（如需要新开）。PM 2026-09-26 通过小秘书授权全做。
