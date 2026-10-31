---
id: 2026-09-24-harness-ledger-v0
title: 建台账最小版：一条一文件、待办邮件每天读、改代码不写台账合并前拦、夜巡核实
status: done
owner: pm
decided_on: 2026-09-24
source: session:beef24ba
verify_by: 2026-09-30
verify_how: ①合并后第一个工作日的今日待办邮件出现"Magic Engine 平台治理"栏下以「台账」开头的条目（NAL Messenger 那张卡过了 9/27 就该出现）；②一个故意写 done_ref pr:999999 的测试 PR 被「Ledger refs exist」拦红。两条都成才算成
done_on: 2026-09-24
done_ref: pr:1984
last_checked: 2026-10-30
check_note: 10-30：PR 1984 MERGED；最新合并 PR 3418 的 gh pr checks --required 里 Ledger entries valid / Ledger refs exist / Code change has ledger entry 三项均 pass，门卫在跑；待办邮件出现台账条目与故意写错 done_ref 的拦红测试未重做，判不了
---
PM 2026-09-24 拍板，DeepSeek 实现、Fable 窗口复审，子牙 + 魏征设计审各一轮。设计在 docs/specs/2026-09-24-harness-ledger-v0.md。
不做：只改台账目录的 PR 免合并审批（PM 待定）。
