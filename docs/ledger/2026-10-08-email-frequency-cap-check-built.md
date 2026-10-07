---
id: 2026-10-08-email-frequency-cap-check-built
title: 邮件「每人 7 天最多 2 封」的发信前自动数数检查已做好（只读，还没接上发信，也没改名单）
status: decided
owner: pm
decided_on: 2026-10-08
source: session:00f65edf
verify_by: 2026-10-15
verify_how: "PM 回复排除名单怎么落地（打标签 / 一次性排除分群 / 只给 PM 看名单）并同意给 CTS 配上限 2 封 / 7 天后，才能接上；接上前不会有任何邮件被拦"
---
检查本身已做好：对一批收件人，按 Mailchimp 的发送记录数每人近 7 天收了几封（含每日 8:02 批次和欢迎流程），满 2 封的排除并出回执。
数不到的：Mailchimp 之外发的邮件、排着队还没发的信，回执里如实写明。
每日 8:02 批次的创建者：Mailchimp 授权应用里只有 Zapier，但没有直接证据，仍是「疑似」。
排除结果怎么落地要先问 PM（写名单），CTS 的上限配置也要 PM 同意后才写进客户配置。
