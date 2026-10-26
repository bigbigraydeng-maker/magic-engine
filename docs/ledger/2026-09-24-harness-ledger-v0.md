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
last_checked: 2026-10-22
check_note: PR 1984 已合并(2026-09-24)；①待办邮件里「台账」开头条目需读真实邮件，今晚未取到；②测试 PR 被拦红未重做，两项缺一不可，判不了；owner 已是 pm
---
PM 2026-09-24 拍板，DeepSeek 实现、Fable 窗口复审，子牙 + 魏征设计审各一轮。设计在 docs/specs/2026-09-24-harness-ledger-v0.md。
不做：只改台账目录的 PR 免合并审批（PM 待定）。
