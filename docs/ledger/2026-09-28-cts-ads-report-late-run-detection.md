---
id: 2026-09-28-cts-ads-report-late-run-detection
title: CTS 日检改成核对广告日报"几点开跑"，迟到超 1 小时或有定时任务卡住超 2 小时都报 P0
status: done
owner: agent
decided_on: 2026-09-28
source: session:b4770bbd
verify_by: 2026-09-30
verify_how: 看 9/29 或 9/30 早上【CTS 日检】的回复里有没有一行写明广告日报昨天几点开跑（新西兰时间）、以及有没有卡住超 2 小时的定时任务；有这一行算成，没有这一行算不成
done_on: 2026-09-28
done_ref: doc:docs/sops/cts-project-manager-playbook.md
last_checked: 2026-10-09
check_note: 夜巡盖章：done_ref 指向的 PR 已合并（或为文档/提交型指向），但 verify_how 要求的实证本晚未取到，不翻状态
---
9/28 广告日报晚了 13 小时才补跑：本机定时任务同时最多 3 个，三个任务卡在等人点"允许"占满名额（App 日志 global_limit）。
不是睡眠、不是夏令时。改了手册日检第 3 项 + 第 4 节，本机 cts-pm-daily 提示词同步改了。
