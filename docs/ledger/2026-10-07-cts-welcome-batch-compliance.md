---
id: 2026-10-07-cts-welcome-batch-compliance
title: CTS 每日 8:02 欢迎批次核查：没有发给禁发的人，但几乎每个人同时收了两封欢迎信
status: decided
owner: pm
decided_on: 2026-10-07
source: doc:docs/ledger/evidence/2026-10-07-cts-welcome-batch-compliance.md
verify_by: 2026-10-08
verify_how: "到 Mailchimp 看 10/7 早上 8:02 那批（auto_e1_batch_20261007）收件人，数其中同时收过 Welcome email 自动流程信的人；PM 决定暂停或去重后，再看 10/8 那批是否还重复"
---
合规：37 批、526 个收件名额里，发信时已带禁发标签 0 人；已付款 2 人（都在 9/1 那封 192 人补发里）；标签发信后才打 38 人。9/27、9/30 两批无违规。
重复：9/2 起 263 个收件名额里 259 个（98%）同时收过自动流程的 Welcome email，通常比批次信早约 18 小时。
批次由 Mailchimp 之外的程序每天 8:02 新建发送，仓库和 Make 里都找不到，疑似 Zapier，未证实；明早 8:02 会照常再发。
建议 PM 决定：先暂停每日批次，还是只补「已收过 Welcome 的人不再进批次」。我没动任何东西。
