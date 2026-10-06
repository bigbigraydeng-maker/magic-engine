# 证据 · 2026-09-28-ledger-body-and-frozen-field-checks · 2026-10-06
fetched_at: 2026-10-06T21:34:34+1300
查了什么：在 origin/main（0bc255878）跑 src/lib/ledger 全部测试；其中 parse.test.ts 有「新卡正文超过 5 行 → 报错」，frozen.test.ts 有「改写 verify_how → 报违规」
数字：7 个测试文件 / 89 条测试全部通过
命令：npx vitest run src/lib/ledger
结论：成，两道检查都有测试守着且通过（用现成测试代替手造违规卡）
