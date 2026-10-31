---
id: 2026-11-01-rejected-call-party-size
title: 人数不再采用已经被驳回的通话分析
status: decided
owner: pm
decided_on: 2026-11-01
source: pr:3433
verify_by: 2026-11-08
verify_how: 订单没有人数、对话摘要也没有人数时，被人工驳回的通话分析里的人数不会拿来算金额。还没审核的通话分析仍然可以用。
---
读通话里的人数时，排除已经被人工驳回的分析。还没审核的不排除。
这样被驳回的人数不会进自动通过的成交金额。
