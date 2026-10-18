---
id: 2026-10-18-reel-promote-todo-alerts-not-wired
title: Reel 转公开出现首评失败或公开后命中红线时，目前只写日志和回执，还没接进今日待办
status: decided
owner: agent
decided_on: 2026-10-18
source: doc:docs/specs/2026-10-18-reel-promote-to-public-design-v0.2.md
verify_by: 2026-10-25
verify_how: 在今日待办里新增一类条目，读转公开回执里需要人看的标记（首评失败、公开后命中红线、写库没写完），说明问题、怎么处理、直达链接；接好后用一条测试回执当场触发一次看到待办出现。
---
首版范围只做转公开动作本身。异常现在会写服务器日志、回执里标需要人看，并在点按钮的管理员页面上直接显示失败原因，但不会自动出现在今日待办。
