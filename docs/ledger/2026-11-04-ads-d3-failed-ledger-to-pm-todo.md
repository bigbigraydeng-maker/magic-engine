---
id: 2026-11-04-ads-d3-failed-ledger-to-pm-todo
title: 广告自动暂停里「系统没法核实」记成 failed 的账，要不要也进今日待办（只登记，未做）
status: decided
owner: agent
decided_on: 2026-11-04
source: pr:3596
verify_how: 先只读查生产近 30 天 ads.auto_pause_on_d3 记成 failed 的账有几条、各是什么原因（读不出开关 / 归属读失败 / 快照过旧 / 内核死信）；PM 定要不要收之后再排；收的话今日待办里出现带广告组名、原因、链接的条目，且不与已有「开发欠账」重复
---
子牙 P2-5：PR 3596 只把 blocked 收进今日待办，failed（系统没法核实 / 内核死信）仍只在账表和开发欠账里。本卡只登记，不在 3596 里做。
