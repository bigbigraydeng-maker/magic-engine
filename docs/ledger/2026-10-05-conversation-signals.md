---
id: 2026-10-05-conversation-signals
title: CTS 合格线索和已付款判断补读邮件/私信/WhatsApp 往来，自动记成交后同步改客户阶段（草稿 PR，等 PM 回「合」）
status: decided
owner: pm
decided_on: 2026-10-05
source: session:4569e58a
verify_by: 2026-10-08
verify_how: 合并后看每天早 6 点 conversion-daily-pipeline 的 ctsSync（qualifiedFromConversation、skippedPastWindow、conversationReadFailed）与 payments（byChannel、stageAdvanced）各几条；合格线索是否明显增加但不过量；有无客人阶段被改错（成交审核页 / CRM 阶段变更审计 actor=auto:payment-detect）
---
做了：付款识别认中文、也读 Messenger（WhatsApp 只识别不自动发）；客户自己说的话也能证明兴趣（要具体意向，bare "interested" 不算）；自动记成交后在发送成功后把阶段推进到已付定金/已付全款（只从 新线索/已联系/已报价/空 出发）。
实测：近 60 天已发私信 1500 条里没有一条像收款确认（付款只走邮件），所以私信付款路径目前读不到东西；近 7 天 56 条新线索里约 10 条客户消息里有具体兴趣。
已知限制：中文词表和阶段 key 写在共享代码里（平台化欠账，需按客户配置化）。
