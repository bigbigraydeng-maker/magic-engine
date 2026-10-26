# 证据：2026-09-25-memory-index-two-level · 取数 2026-10-10（NZ 时间，日历巡检只读核实）

fetched_at: 2026-10-10 NZ
命令：bash ~/.claude/scripts/memory-index-check.sh
退出码：1（FAIL）
输出：
FAIL MEMORY.md = 20982 字节（应 < 17000）
OK   391 个记忆文件全部在索引里（总索引 + 4 份分区索引）
OK   索引里没有指向不存在文件的链接

结论：三项里两项 OK，但总索引 MEMORY.md 已涨到 20982 字节，超出 17000 的上限，判据要求退出码 0，未达成。样本 = 391 个记忆文件、1 次运行。
