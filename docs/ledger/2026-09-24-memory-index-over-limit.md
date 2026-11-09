---
id: 2026-09-24-memory-index-over-limit
title: Claude 记忆索引超过截断线、114 个记忆文件没进索引——新写的教训可能根本没被加载
status: failed
owner: agent
decided_on: 2026-09-24
source: session:beef24ba
verify_by: 2026-10-01
verify_how: MEMORY.md 小于 17KB，且 memory 目录里每个 .md 都在索引里有一行（脚本数一遍两边对得上）
done_on: 2026-09-25
done_ref: doc:docs/ledger/evidence/2026-09-24-memory-index-over-limit--check.sh
verified_ref: doc:docs/ledger/evidence/2026-09-24-memory-index-over-limit--2026-09-25.md
last_checked: 2026-09-25
check_note: 原判据数学上做不到：348 个文件名字节和已超 17KB；整理后改两级索引，接替卡 2026-09-25-memory-index-two-level
---
2026-09-24 审计查出：索引 29.6KB（目标 17.1KB），346 个文件里 114 个不在索引。
这是"规矩记了但执行时没调出来"那一簇（14 次）的直接原因之一。
接替卡：2026-09-25-memory-index-two-level（两级索引，脚本可验）。算式与合并清单见 verified_ref。
