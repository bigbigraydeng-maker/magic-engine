---
id: 2026-10-14-ledger-refs-daily-full-sweep
title: 后续：加一个每天一次的台账指针全库核对定时任务（LEDGER_REFS_FULL=1），补上「PR 只查改动卡」留下的 pr 和 issue 指针的覆盖缺口
status: decided
owner: agent
decided_on: 2026-10-14
source: pr:2580
verify_by: 2026-10-21
verify_how: .github/workflows 里有每天一次、带 LEDGER_REFS_FULL=1 的定时检查，失败时进今日待办；一天约 225 次接口调用，在额度内
---
PR 2580 把每个 PR 的台账指针核对缩到「本 PR 改动的卡」；commit:/doc: 两类本地指针仍对全库每次核对。pr:/issue: 指针对旧卡不再每 PR 复查，需要这个每日全库核对兜底。要改 .github（A 级），另开 PR；2580 合并后再做。
