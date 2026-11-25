# 证据 · 2026-10-06-pr2299-merged-by-pm-before-weiqing-review · 2026-11-26
fetched_at: 2026-11-26T05:19:56+1300
查了什么：方案主 PR2285 是否在卫青复核补丁 PR2309 并入后合进主干；预算余量代码文件是否在主干上。
数字：gh pr view 2285 → MERGED 2026-10-06T15:26:23Z，base=main，合并人为 PM 本人账号，合并提交 1968648ac 是当前 origin/main 的祖先；gh pr view 2309 → MERGED 2026-10-06T15:21:33Z（base=方案分支），其合并提交 03d8697c7 是 1968648ac 的祖先（先进方案分支、再随 2285 进主干）。主干上 src/lib/ads-strategy/launch-budget-headroom.ts 存在（及其测试文件）。
来源/命令：gh pr view 2285/2309 --json state,mergedAt,baseRefName,mergedBy,mergeCommit；git merge-base --is-ancestor；ls 文件（夜巡工作副本 = origin/main aab08c906）。
结论：成。复核补丁先并入、方案随后合进主干，预算余量代码在主干上。
