---
id: 2026-09-25-ledger-only-pr-auto-merge
title: 只改台账目录的 PR 免 PM 合并审批、CI 全绿自动合；三道台账检查进主干必过清单
status: done
owner: pm
decided_on: 2026-09-25
source: session:beef24ba
verify_by: 2026-09-29
verify_how: ①9/27 或 9/28 夜巡开出的 claude/ledger-verify-* PR 没有人点、自己合进了主干；②一个改了 src/ 的测试 PR 在「Ledger refs exist」红的情况下按不了合并。两条都成才算成
done_on: 2026-09-25
done_ref: pr:1988
last_checked: 2026-10-12
check_note: 夜巡盖章：done_ref 指向的 PR 已合并（或为文档/提交型指向），但 verify_how 要求的实证本晚未取到，不翻状态
---
PM 2026-09-25 回「合，免」。魏征复审指出：每翻一张卡都要 PM 点一次合并 = ROADMAP 的死法复刻。
代价明说：非夜巡分支的台账专属 PR 也免审，只靠格式 + 指向检查兜底，能改卡的标题/判据。
