---
id: 2026-10-07-cts-welcome-batch-dedup-design
title: CTS 每日欢迎批次重复发信：查明是表格脚本生成，已出去重改法，等 PM 点头才改
status: decided
owner: pm
decided_on: 2026-10-07
source: doc:docs/ledger/evidence/2026-10-07-cts-welcome-batch-dedup-design.md
verify_by: 2026-10-10
verify_how: "先看 PM 是否已点头并改完表格脚本；改完后看第一个 8:02 批次（标签 auto_e1_batch_日期）收件人里有没有同时收过 Welcome email 的人，应为 0；没改就如实写没改"
---
生成者是 PM 自己 Google 账号里的表格脚本 dailySendE1Batch，不知道 Mailchimp 欢迎流程存在，所以每个新人收两封。
建议只在选人那一处加「已收过欢迎流程那封信就跳过」，约 25 行，试跑和回滚见证据文件。我没改任何配置。
