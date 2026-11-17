# 证据 · 2026-10-09-crm-all-page-split-round3 · 2026-11-17
fetched_at: 2026-11-17T23:39:44+1300
查了什么：判据要求 page.tsx 行数 < 800，且 all/__tests__ 全绿。
数字：origin/main（e79b8eafa）上 wc -l 得 916 行；npx vitest run all/__tests__ → 6 个文件 86 条全过，退出码 0。
来源/命令：wc -l "src/app/dashboard/clients/[id]/crm/all/page.tsx"；npx vitest run "src/app/dashboard/clients/[id]/crm/all/__tests__"；拆分 PR 2615 已于 2026-10-14 合并，之后该文件又被多次改动（最近一次 04ad4e1ca 直达链接修复）。
结论：不成——测试全绿，但主文件已长回 916 行，超过判据的 800 行线。
