# 证据 · 2026-09-25-memory-index-two-level · 2026-10-05
fetched_at: 2026-10-05T21:33:24+1300
查了什么：跑 bash ~/.claude/scripts/memory-index-check.sh
数字：MEMORY.md = 18686 字节（要求 < 17000）；376 个记忆文件全部在索引里（OK）；无指向不存在文件的链接（OK）。退出码 1。
来源/命令：bash ~/.claude/scripts/memory-index-check.sh
结论：不成。三条里「MEMORY.md 小于 17000 字节」这条又超了（这周新增记忆把总索引撑回 18686）。
