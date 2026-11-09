#!/usr/bin/env bash
# 核对 Claude 持久记忆索引（magic-engine 项目）。
#
# 判据（台账卡 2026-09-25-memory-index-two-level 的 verify_how）：
#   1. MEMORY.md 小于 17000 字节（wc -c）——超过这条线，后面的条目开窗口时不会被加载
#   2. memory 目录里每个 .md（含子目录，不含 MEMORY.md 自己）都在 MEMORY.md
#      或 MEMORY.md 直接链接到的分区索引 memory-index-*.md 里有一条链接（两跳可达）
#   3. 索引里没有指向不存在文件的链接（dangling）
# 只读；退出码 0 = 全过，1 = 有一条不过。任何机器都能跑，不依赖仓库。
set -uo pipefail

MEM_DIR="${MEMORY_DIR:-$HOME/.claude/projects/-Users-raydeng-Projects-magic-engine/memory}"
LIMIT="${MEMORY_INDEX_LIMIT:-17000}"
cd "$MEM_DIR" || { echo "找不到记忆目录 $MEM_DIR"; exit 1; }

fail=0
bytes=$(wc -c < MEMORY.md | tr -d ' ')
if [ "$bytes" -lt "$LIMIT" ]; then
  echo "OK   MEMORY.md = ${bytes} 字节（< ${LIMIT}）"
else
  echo "FAIL MEMORY.md = ${bytes} 字节（应 < ${LIMIT}）"; fail=1
fi

# 分区索引 = MEMORY.md 里直接链接到的 memory-index-*.md
sub_indexes=$(grep -o '([^)]*memory-index-[^)]*\.md)' MEMORY.md | tr -d '()' | sort -u)
index_files="MEMORY.md"
for s in $sub_indexes; do
  if [ -f "$s" ]; then index_files="$index_files $s"; else echo "FAIL 分区索引不存在: $s"; fail=1; fi
done

# 所有被引用的文件名（markdown 链接 (x.md)）
linked=$(cat $index_files | grep -o '([^)]*\.md)' | tr -d '()' | sed 's|^\./||' | grep -vx 'MEMORY.md' | sort -u)
# 目录里所有 .md（含子目录），排除 MEMORY.md
all=$(find . -name '*.md' -not -name 'MEMORY.md' | sed 's|^\./||' | sort -u)

missing=$(comm -23 <(echo "$all") <(echo "$linked"))
dangling=$(comm -13 <(echo "$all") <(echo "$linked"))

n_all=$(echo "$all" | grep -c . || true)
n_missing=$(echo "$missing" | grep -c . || true)
n_dangling=$(echo "$dangling" | grep -c . || true)

if [ "$n_missing" -eq 0 ]; then
  echo "OK   ${n_all} 个记忆文件全部在索引里（总索引 + $(echo "$sub_indexes" | grep -c . || true) 份分区索引）"
else
  echo "FAIL ${n_missing}/${n_all} 个文件不在任何索引里："; echo "$missing" | sed 's/^/     /'; fail=1
fi
if [ "$n_dangling" -eq 0 ]; then
  echo "OK   索引里没有指向不存在文件的链接"
else
  echo "FAIL ${n_dangling} 条链接指向不存在的文件："; echo "$dangling" | sed 's/^/     /'; fail=1
fi

exit $fail
