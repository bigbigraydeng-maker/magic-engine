# 证据 · 2026-09-28-risk-case-insensitive-a-rules · 2026-10-06
fetched_at: 2026-10-06T21:34:34+1300
查了什么：在 origin/main（0bc255878）跑 tools/ops-review-loop/tests/risk.test.ts；测试里有「A rules match case-insensitively」一组，对每条 A 级路径做大小写互换后仍要判 A
数字：1 个文件 / 370 条测试全部通过
命令：npx vitest run tools/ops-review-loop/tests/risk.test.ts
结论：成，大小写混合路径仍判 A，测试全绿
