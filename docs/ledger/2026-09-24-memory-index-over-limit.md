---
id: 2026-09-24-memory-index-over-limit
title: Claude 记忆索引超过截断线、114 个记忆文件没进索引——新写的教训可能根本没被加载
status: decided
owner: agent
decided_on: 2026-09-24
source: session:beef24ba
verify_by: 2026-10-01
verify_how: MEMORY.md 小于 17KB，且 memory 目录里每个 .md 都在索引里有一行（脚本数一遍两边对得上）
---
2026-09-24 审计查出：索引 29.6KB（目标 17.1KB），346 个文件里 114 个不在索引。
这是"规矩记了但执行时没调出来"那一簇（14 次）的直接原因之一。
