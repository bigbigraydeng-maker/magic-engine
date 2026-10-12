---
id: 2026-10-06-calendar-daily-closure-audit-rebuilt
title: 日历上带日期的验证事项，每天早上自动核对并闭环（定时任务重写并重新启用）
status: done
owner: agent
decided_on: 2026-10-06
source: session:ca1d7290
verify_by: 2026-10-08
verify_how: 看 10 月 7 日和 8 日两天的回执文件都在、日历里新出现的已验证和没达预期标记、每晚台账夜巡昨晚有没有跑成；两天都按时自动跑且没卡权限弹窗才算成
done_on: 2026-10-06
done_ref: doc:docs/ledger/evidence/calendar-verification-audit--prompt-after-20261006.md
last_checked: 2026-10-12
check_note: 夜巡盖章：done_ref 指向的 PR 已合并（或为文档/提交型指向），但 verify_how 要求的实证本晚未取到，不翻状态
---
PM 2026-10-06 要求每天有人核日历里的验证事项；统筹转达同意。原提示词存档在同目录 prompt-before 文件，回滚就是换回它。
当场试跑一次：处理 30 条，已验证 8、没达预期 3、没查成 18、等 PM 动手 1，回执在本机 calendar-audit-receipts 目录。
9 月 22 日之前的旧事件另有清单（evidence 目录 calendar-backlog 文件），等 PM 点头再批量关。
