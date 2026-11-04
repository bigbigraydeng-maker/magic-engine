---
id: 2026-10-08-lead-sheet-cleanup-done
title: CTS 留资总表清理完成：删掉 718 行错位行，表从 1569 行变 851 行，已有备份页签
status: done
owner: agent
decided_on: 2026-10-07
done_on: 2026-10-08
done_ref: pr:2360
source: session:d925e4da
verify_by: 2026-10-10
verify_how: 只读那张表，所有行都应从 A 列开始、行数只增不减；cron_run_logs 里 lead-sheet-sync 最近几轮 appended 应为 0 或个位数且 error 为空
last_checked: 2026-10-29
check_note: 10-29 查 cron_run_logs：lead-sheet-sync 近 7 天 166 轮全部 completed、error 为空，单轮 appended 最多 3、合计 14，最新一轮 matched 197/已在表 197；表格本身没读（夜巡没有表格只读工具），A 列起始这半判不了
---
清理前先建了隐藏备份页签，错位行是 CTS 另一条写入通道插行后顺延出的 718 行，正常线索一条没少。
清理后试算窗口内 164 条线索全在表里。备份页签链接见 2026-10-07-lead-sheet-append-misplaced-rows 卡。
