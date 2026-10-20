---
id: 2026-10-20-crm-new-message-reminder
title: CRM 页面加「新消息提醒」：每 30 秒问一次有没有客人发来新消息，有就在导航上方出一条提示并在浏览器标签标题显示数字，点一下刷新；WhatsApp、私信、邮件共用
status: decided
owner: pm
decided_on: 2026-10-20
source: session:96dc6edf
verify_by: 2026-10-23
verify_how: 合并部署后，打开 CTS 的 CRM 全部客人页别动；让 PM 用手机给 CTS 的 WhatsApp 号发一条消息，30 秒内页面上方出现「有 1 位客人发来新消息（WhatsApp 1）」、浏览器标签标题出现 (1)；点刷新后新客人出现在列表；页面在后台标签页时不发请求
---
只做提醒和刷新，不做声音和手机推送；AI 起草、人工批准是下一件，要 PM 点头。
