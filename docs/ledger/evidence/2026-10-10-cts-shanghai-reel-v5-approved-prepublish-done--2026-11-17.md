# 证据 · 2026-10-10-cts-shanghai-reel-v5-approved-prepublish-done · 2026-11-17
fetched_at: 2026-11-17T23:39:44+1300
查了什么：工单 fa4fdd89 的发布状态与回执。
数字：生产库 content_work_orders 该行 status=published；published_ref 非空，platform=facebook，video_state=PUBLISHED，published_at=2026-10-11T04:35:44Z，first_comment_id 有值（首评已发）。
来源/命令：Supabase 只读 select status, published_ref from content_work_orders where id='fa4fdd89-…'。
未查：评论里链接的追踪参数、首批播放/点击（续投与否属人判，不在本结论内）。
结论：成——判据主项「status=published 且 published_ref 非空」成立，首评在。
