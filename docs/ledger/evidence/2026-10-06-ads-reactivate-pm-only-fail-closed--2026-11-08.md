# 证据 · 2026-10-06-ads-reactivate-pm-only-fail-closed · 2026-11-08
fetched_at: 2026-11-08T21:35:34+13:00
查了什么：卡上 commit e0c1440d7 所在的改动单是否合并进主干；两审（卫青、狄仁杰）发现是否已修；合并后在主干上用假 Meta 重跑两入口测试。
数字（带样本量、两边取数状态）：
- gh pr view 2310：MERGED 2026-10-06T03:01:35Z（合并账号 bigbigraydeng-maker）；commit e0c1440d7 在 origin/main 上（git branch -r --contains 命中 origin/main）。
- PR 2310 正文：「两审：卫青、狄仁杰各一轮，发现已修；剩余项开了三张台账卡」。该条只能以改动单正文为准，夜巡没有逐条复核审查原文。
- 今晚在 origin/main（84bef08e2）工作副本上跑 PR 2310 改过的 6 个测试文件（全部用假 Meta / 假数据库）：6 个文件 162 条测试全过，退出码 0。
来源/命令：gh pr view 2310 --json mergedAt,mergedBy,body；git branch -r --contains e0c1440d7；npx vitest run <PR 2310 的 6 个测试文件>
结论：成。改动已在主干，合并后在当前主干上重跑两入口测试全过。未覆盖：PR 正文自述「条件写入只在假数据库测过，没在真实库跑过」，这一项不在本卡判据内。
