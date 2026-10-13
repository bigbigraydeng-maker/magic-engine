---
id: 2026-10-14-ledger-refs-check-incremental
title: 「Ledger refs exist」只核对本 PR 新增/改动的卡，同一 PR 号一次运行只查一次；全库核对留给本机/定时（LEDGER_REFS_FULL=1）
status: done
owner: agent
decided_on: 2026-10-14
done_on: 2026-10-14
done_ref: pr:2580
source: pr:2580
verify_by: 2026-10-21
verify_how: 一周内各 PR 不再因「台账引用/风险门/改动范围」轮流因接口超限变红；一次运行的接口调用数从 225 降到个位数
---
根因：脚本每次对全库 560 张卡的指针逐个调接口（实测 225 次），CI 令牌每小时约 1000 次，几个 PR 并行或重跑就耗尽，之后所有走接口的检查一起红。改法见脚本头注；失败仍然关闭（改动卡里查不到的指针一律红，接口超限时也红）。A 级：改仓库规则脚本，需 PM 同意后用管理员合并。全库每日核对的定时任务这次没加（需另改 .github，单独一个 PR）。
