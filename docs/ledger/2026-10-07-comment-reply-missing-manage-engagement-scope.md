---
id: 2026-10-07-comment-reply-missing-manage-engagement-scope
title: 客人在 CTS 帖子下的留言自动回复一直失败：授权清单漏了「管理和回复评论」权限
status: decided
owner: agent
decided_on: 2026-10-07
source: session:d925e4da
verify_by: 2026-10-14
verify_how: CTS 主页管理员重新点「连接 Meta」后，下一轮评论自动回复在 social_comment_engagements 里应出现 replied（不再 failed），今日待办里那条回复失败的卡自己消失
---
授权清单补上 pages_manage_engagement，并在今日待办里下发「连接 Meta」三件套。
这一步只有主页管理员能做；修好后才会真回复客人，上线要 PM 本人回「合」。
