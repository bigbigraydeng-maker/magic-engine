---
id: 2026-10-26-expert-learning-first-run
title: 第一次正式专家学习：3 位专家文章提炼成待审核经验，Ray 在广告引擎页点开才采纳
status: decided
owner: pm
decided_on: 2026-10-26
source: issue:3088
verify_by: 2026-10-30
verify_how: Ray 先看 dryRun 输出；同意后真写一次，在广告引擎页看到未启用候选且带来源链接，点开一条后其它客户的提示词里能读到它
---
最短路线，不做迁移、不做新表、不登记定时任务。单次运行 0.20 美元硬上限。
首批专家：Jon Loomer / Glenn Gabe / Common Thread Collective，"为什么可信"写在 `expert-roster.ts` 注释里，Ray 已确认（2026-10-26）。
已知缺口：读取侧没有自动到期，首批建议不超过 10 条，到期日记在 evidence。
已知缺口：并发运行可能覆盖已启用经验（Codex P2，推迟）——两次非演练运行同时处理同一新候选时，慢的一方可能把 Ray 已点开的经验改回未启用；入口仅管理员手动触发、无定时任务，实际不会并发。
