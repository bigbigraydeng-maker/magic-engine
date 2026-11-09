---
id: 2026-10-28-crm-followup-send-ledger-shared-count
title: 7 天 2 封额度只能有一个数数函数：127 号稿的 evaluateFrequency、PR 2363 的 Mailchimp 活动流、Newsletter 手册的 NL-04 各定义了一个，要合成一个；第 1 次当天只发 1 封、替代自动欢迎信
status: decided
owner: agent
decided_on: 2026-10-28
source: doc:docs/specs/2026-10-28-crm-followup-ai-upgrade-design-v0.md
verify_how: 回放 10 月 5 至 6 日两批收件人，数出去重后 41 人里 30 人已满 2 封（PR 2363 试跑值）；数数来源取并集（Outlook 已发送箱含密送、ME 审计行、邮件出站触点、Mailchimp 群发加欢迎流程的活动记录），任一来源读不到按已满；Newsletter 发前闸、127 号发信闸、本稿的跟进建议三处调用的是同一个函数，grep 只看到一处定义；PM 10-28 口径含群发与销售一对一，回信是否计入默认计入。
---
ME 触点库里没有 Mailchimp 的发出记录，只有打开和点击；现有欢迎流程加每日批次本来就在叠发（41 人抽样 30 人满额）。127 号稿的四来源并集数不到欢迎流程，PR 2363 的活动流法能数到，两者要合起来。
统管 v0 第 1 次含自动欢迎信加通话后邮件，再加第 2 次，7 天内 3 封；线索链按 0、3、7 天发才满足 7 天 2 封，前提是第 1 次当天只发 1 封。
A 级，因为它是发信闸的一部分；实现归 127 号和 126 号的发信闸，本稿只提出合并要求。
