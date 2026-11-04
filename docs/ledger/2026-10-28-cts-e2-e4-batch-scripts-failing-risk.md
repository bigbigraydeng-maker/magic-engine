---
id: 2026-10-28-cts-e2-e4-batch-scripts-failing-risk
title: 表格里 E2/E3/E4 每日定时任务一直报错发不出，队里排着数百人，修好会一次性群发旧信，建议先停掉
status: decided
owner: pm
decided_on: 2026-10-28
source: session:82f88edf
verify_by: 2026-11-04
verify_how: "PM 同意后，到 Apps Script 触发器页停用 E2/E3/E4 三个每日任务；之后运行记录里不再出现这三个任务；在此之前任何人都不要去「修」它们的报错"
---
10/28 运行记录：E2 待发 475 人、E4 待发 528 人，建活动时都被 Mailchimp 拒绝（400），没发出；E3 同类（10/7 核查记录）。
疑似原因之一：表里一行邮箱末尾多了「>」，没法证实。修好后会按队里名单立刻群发 7 月的旧 E2–E4 信，违反每周 2 封。
我没动脚本和触发器；停用需 PM 明确说一句。
证据全文：docs/ledger/evidence/2026-10-28-cts-welcome-email-audit.md
