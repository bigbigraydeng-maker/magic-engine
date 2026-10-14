---
id: 2026-09-25-memory-index-two-level
title: 记忆索引改成两级——总索引留在截断线以下，四份分区索引兜住其余文件，每个记忆文件两跳可达
status: failed
owner: agent
decided_on: 2026-09-25
source: doc:docs/ledger/evidence/2026-09-24-memory-index-over-limit--2026-09-25.md
verify_by: 2026-10-02
verify_how: 跑 bash ~/.claude/scripts/memory-index-check.sh（仓库副本 docs/ledger/evidence/2026-09-24-memory-index-over-limit--check.sh）退出码 0，三条同时成立：MEMORY.md 小于 17000 字节；记忆目录里每个 .md 都在 MEMORY.md 或 MEMORY.md 直接链接到的 memory-index-*.md 里有一条链接；索引里没有指向不存在文件的链接。到期那天把这周新写进记忆目录的文件也一并数进去
done_on: 2026-09-25
done_ref: pr:1993
last_checked: 2026-10-10
check_note: 日历巡检 10-10 重跑核对脚本：退出码 1，MEMORY.md 20982 字节超过 17000 上限（其余两项 OK）；需把总索引里的细目挪进分区索引
verified_ref: doc:docs/ledger/evidence/2026-09-25-memory-index-two-level--2026-10-10.md
---
接替 2026-09-24-memory-index-over-limit（原判据"全部文件都在 MEMORY.md 一个文件里且小于 17KB"数学上做不到，已翻 failed，算式见证据文件）。
2026-09-25 已做：读完 144 个未索引文件，27 个合并进手册/主题记忆后挪出目录，其余全部入索引；总索引 13,642 字节，326 个文件两跳全覆盖。
两级索引的代价写在证据文件末尾：分区索引条目不随开窗口自动加载，靠总索引顶部入口引导。
