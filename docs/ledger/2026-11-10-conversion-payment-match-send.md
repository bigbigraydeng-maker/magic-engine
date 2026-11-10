---
id: 2026-11-10-conversion-payment-match-send
title: 定金已收且金额等于所订团每人标价时，自动把成交告诉广告平台
status: done
owner: agent
decided_on: 2026-11-10
done_on: 2026-11-10
done_ref: commit:4bfbcb7b0cc630d988b55616ae33a005bed52a28
source: doc:docs/ledger/2026-09-26-conversion-expired-sweep-regardless-of-toggle.md
verify_by: 2026-11-17
verify_how: 合并并把数据库那一列加上之后，下一个早上金额对得上的成交留有自动回传记录（规则和两边金额），对不上的仍在待核对邮件里；开关关着的客户一条都不发。
---
派活等级 L4，写代码模型 Grok 4.7。这是云端代理直接写的，不是默认的 Opus 派活。
定金已在 CRM 标成已收，且成交金额等于所订团现在的每人标价，才自动告诉广告平台。
客人不一致、金额对不上、资料不够，仍留在待核对。开关默认关，只给 CTS 打开，跟模型审核分开。
2026-11-10 13:47 NZDT 本机试跑退出码 0：对得上的走试运行，对不上的仍待核对。没有写生产库，没有呼叫广告平台。
上线前要先在数据库加上这一列。规则和两边金额写在自动回传记录里。
