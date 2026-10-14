---
id: 2026-10-14-cts-unsubscribed-still-got-newsletters
title: 一位客人 9/24 在私信里要求退订，但系统里一直没标，其后仍收到两封群发
status: decided
owner: pm
decided_on: 2026-10-14
verify_by: 2026-10-21
verify_how: 这位在 Mailchimp 里有抑制标签且不在任何进行中的自动邮件流程里；另外三位今天同时补标的也同样有抑制标签；都由 102 号在 PM 登录后核实并回执
source: session:90a50c3b
---
事实：退订消息 2026-09-24（Facebook 私信，原话一个词 Unsubscribe）；系统里补标 2026-10-14；其间收到 9/28、10/8 两封群发，另在欢迎流程里。
为什么没标：全仓只有「新消息命中退订词」这一条自动路径，历史会话无从补标，也没有人工入口（见卡 2026-10-14-manual-do-not-contact-entry-missing）。
为什么 10/14 的每日同步没补上：同步每天一次、这次跑在补标之前，不是同步坏了；明天那次按选人条件会带上。
补救动作：补抑制标签、暂停旧的欢迎邮件，由 102 号在 PM 登录 Mailchimp 后做。「是否先收后标」以外的因果证实不了。
待 PM 决定是否请人确认。
