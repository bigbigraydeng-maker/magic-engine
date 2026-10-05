# 证据 · 2026-09-27-risk-gate-config-secret-files-a · 2026-09-27
fetched_at: 2026-09-27T13:20:20+13:00
查了什么：①主干（#2071 已合，main 5be460f1）的 risk.mjs 对 .env.production / .gitignore / next.config.js / tsconfig.json / vitest.config.ts 各跑一次 classifyRisk；②只改根目录 .gitignore 的真实 PR 上 Risk gate 的判级。
数字（带样本量、两边取数状态）：
- ①5/5 判 A（取数成功，本机 node 直接调主干代码）。
- ②探测 PR #2102（只改根目录 .gitignore 一行注释）：Risk gate 判 A，原因「忽略清单 —— 删一行就能把 .env.local 这类密钥文件放进仓库」，自动合并关闭（取数成功，来源 github-actions[bot] 判级评论）。注：该 PR 是草稿，草稿本身也会关自动合并；判级 A 由评论原文确认。同批 #2101 next.config.js、#2103 vitest.workspace.ts 也判 A（3/3）。
来源/命令：node -e "classifyRisk(...)"（main 5be460f1）；gh api issues/2101-2103/comments；结果评论见 PR #2071。
结论：成——这些文件改动在主干上判 A，不再无人自动合。
