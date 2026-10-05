---
id: 2026-10-04-cts-payment-email-and-qualified-lead-design
title: CTS 邮箱付款自动识别成交：第一批已写好（草稿 PR），合并和数据库那一步等 PM 点头；合格线索与阶段回传暂缓
status: decided
owner: pm
decided_on: 2026-10-04
source: session:4569e58a
verify_by: 2026-10-08
verify_how: PM 批准合并并执行数据库那一步、再在 CTS 配置里打开邮箱付款识别后，等下一次每日同步跑完，看成交审核页是否出现"邮箱抓取"来源的记录，以及运行汇总里自动成交/待人工/缺金额各几条；缺金额的定金占大头（真实邮件里金额多在附件发票里），要不要继续做"读发票 PDF 取金额"由 PM 决定
---
设计稿：docs/specs/2026-10-04-cts-payment-email-detection-and-qualified-lead-feedback.md（v0.2 + §11 实测发现）。
做了：识别器、双车道批处理、流水线新段、AI 自动批准改白名单、防重迁移（均未合并/未 apply/未真发）。
没做：合格线索规则、CRM 阶段回传（月线索量擦边 200，先不做）、读发票 PDF 取金额。
