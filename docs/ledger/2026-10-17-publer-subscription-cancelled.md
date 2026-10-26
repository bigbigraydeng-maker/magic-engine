---
id: 2026-10-17-publer-subscription-cancelled
title: PM 10-17 说已在 Publer 官网取消订阅，并要求整个系统删除 Publer；订阅取消生效未独立核实，代码分 4 个 PR 删除
status: decided
owner: pm
decided_on: 2026-10-17
source: session:c45254ff
verify_by: 2026-10-29
verify_how: 看 10-28 前后账单里有没有 Publer 的新扣费，Publer 后台订阅页是否显示已取消；git grep -il publer -- src 的结果是否只剩有意保留的字符串守卫；4 个删除 PR 是否都已合并
---
PM 在聊天里说「我已经登录 publer，取消了订阅，你这里做相应的代码处理」。我的浏览器窗格没有登录 Publer，**无法独立核实取消是否生效**，记作「PM 称已取消」。已加日历提醒（10-29 查扣费）。
代码删除分 4 个 PR：①前端入口与轻量引用（B）②Instagram 跟发整套（B）③Publer 本体与内核边界清单（A，三审加 PM 点头）④LinkedIn 自动发帖（A，涉及 render.yaml）。数据库里 publer 痕迹（content_posts.publer_post_id、client_connectors 的 publer 行、flywheel_actions.vendor）只记录不删列。
PM 删 Publer 等于「经 Publer 发 Instagram、TikTok、领英」不再做，Launch Hub 里的推送 Publer 按钮随之去掉；Launch Hub 本身的去留另议。
