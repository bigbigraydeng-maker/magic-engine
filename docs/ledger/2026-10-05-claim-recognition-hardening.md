---
id: 2026-10-05-claim-recognition-hardening
title: 发布闸的价格/日期识别补强（认出 NZD、¥、元、15 March 等写法）已做完，等影子统计和 PM 回「合」
status: done
owner: agent
decided_on: 2026-10-05
source: session:1bfd1871
verify_by: 2026-10-08
verify_how: 协调窗口跑审计文档里那段只读 SQL，命中行逐条判是不是真价格；全是真价格才算过，样本总数随结论报
done_on: 2026-10-05
done_ref: pr:2250
last_checked: 2026-10-12
check_note: 夜巡盖章：done_ref 指向的 PR 已合并（或为文档/提交型指向），但 verify_how 要求的实证本晚未取到，不翻状态
---
草稿 PR 已开（A 级），未合并；合并由 PM 回「合」。本 PR 不接任何渠道、不替换 copy-generator 的旧日期规则（留给第 4 步）。
白名单绑 tour_id 未做，依赖第 3 步产品事实源。影子统计跑完、严口径无误伤前，不要合。
