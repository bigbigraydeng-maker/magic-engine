---
id: 2026-10-08-calendar-closure-audit-step1-live-trial
title: 日历到期事项每日核对第一步已写好待上线，还差读日历的机器账号和线上第一次真跑
status: verified
owner: agent
decided_on: 2026-10-08
source: pr:2367
verify_by: 2026-10-12
verify_how: 看运行记录里 calendar-closure-audit 有一条成功的记录、回执状态是 ok 而不是读不到日历，且今日待办里能看到这一栏或明确无事；不成就先查机器账号是否建好并共享了日历。
done_on: 2026-10-12
done_ref: pr:2367
verified_ref: doc:docs/ledger/evidence/2026-10-08-calendar-closure-audit-step1-live-trial--2026-10-12.md
last_checked: 2026-10-12
check_note: 定时那一轮 10/12 07:20 真实运行完成，回执 ok，读到 110 条
---
代码在拉取请求 2367（草稿，等 PM 回合）。上线前要 PM 同意新建读日历的机器账号并共享 hello 日历。
上线后要去 Inngest 后台手动同步一次，并用手动入口真跑一遍，把结果补进 PR。第二步（自动改台账和日历）不在本卡范围。
