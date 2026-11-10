---
id: 2026-11-10-me-send-gate-cts-shares-me-resend-account
title: CTS 客人的自动信共用 ME 现有的 Resend 发信账号（PM 回「共用」）；以后发 newsletter 之前要再问 PM 一次要不要单开
status: decided
owner: agent
decided_on: 2026-11-10
source: session:33ebcd0b
verify_how: 看是否已：①第 2 单（回执消费）合并时，系统账号收到的回执里，ME 自动信能按供应商邮件 id 对上发送账本，对不上的 ME 自己的系统邮件不报警、不重试；②newsletter（P5）开工之前，PM 已被再问一次「单开还是继续共用」，并留有他的回答。缺哪件写哪件
---
PM 11-10 在 129 窗口回「共用」（对发信设计窗口提的单开/共用风险问题）。已向 PM 说明并由其接受的风险：账号一旦因投诉或退信被封，ME 的登录邮件、每日待办邮件和 CTS 官网询价通知会一起停。
做法：PM 随后又回「行」：发件地址用 news.ctstours.co.nz（129 11-10 已在同一账号里加好该域名和 3 条解析），回信地址 info@ctstours.co.nz，显示名 Baker from CTS Tours；Render 加 RESEND_API_KEY_CTS（同一账号里新建、只限 news. 域名的发信钥匙）和 UNSUBSCRIBE_SIGNING_SECRET；不开新账号、不建新回执。发信接口「拒 system、不回落」的保护照旧。
最大风险在以后两周一次、发一千多人的 newsletter，所以那之前再问一次（129 的建议）。换掉或删掉 CTS 那把钥匙时，第 3 单的发信会拿到「账号问题」并立刻停发、出待办，不会把客人卡成「结果不明」。
