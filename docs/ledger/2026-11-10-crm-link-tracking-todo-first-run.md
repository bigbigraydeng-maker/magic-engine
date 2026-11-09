---
id: 2026-11-10-crm-link-tracking-todo-first-run
title: 「邮件点击追踪坏了」这条开发欠账检查，第一次每天自动跑完要核一次：没报错、没误报
status: decided
owner: agent
decided_on: 2026-11-10
source: pr:3719
verify_by: 2026-11-17
verify_how: "Ray 合并 #3719（两张表建好）后的第一个工作日早上，看今日待办生成的日志和结果：①没有出现「[manual-items] 邮件点击追踪检查失败」这一行；②开发欠账里没有 crm_link_tracking_silent（这时还没开追踪，应为 0 条）；③其它待办数量和前一天同量级。三条都对算成；①出现就去看 crm_email_link_tokens / crm_email_link_clicks 是否已建好。"
---
当场跑不了的原因：这项检查读的两张表（crm_email_link_tokens、crm_email_link_clicks）要等 Ray 亲手合并 #3719 时才建；2026-11-09 13:49 UTC 用只读查询确认线上两张表都还不存在。在那之前，检查读表失败只会写一行日志、不挡其它待办（有单元测试）。
