---
id: 2026-09-27-wp2-notice-sort-fix
title: 修 WP2 判据按字符串排时间的 bug（带时区偏移的通知会被甩到最后，AI 回复因此被算成真人）+ 纠正一处写反的注释
status: decided
owner: agent
decided_on: 2026-09-27
source: session:5b9407a2
verify_by: 2026-10-03
verify_how: 跑 `npx tsx --env-file=<.env.local> scripts/probe-wp2-human-reply.ts`，CTS 四个数字仍应是 500 / 377 / 6 / 117；再跑 automation.test.ts，两条时区用例必须绿
---
魏征复审 #2061 抓到的（W61-4 / W61-3 / W61-5），代码已在主干但还没有调用方，所以线上没受影响。
W61-4 真 bug：lastHumanPageReplyAt 用 localeCompare 排时间。`…T10:01:00Z` 和 `…T22:00:00+12:00` 是同一天不同写法，字符串比较把后者甩到最后。已复现：客人 09:59Z 来信 → 通知写成 22:00+12:00 → AI 回复写成 10:01Z，排成「来信→AI 回复→通知」，那条 AI 回复在「还没接管」状态下被判成真人。改成按 Date.parse 的时刻排，解析不出来的排最后。两条回归测试钉住。
W61-3 注释写反：原来写「认不出通知方向安全，最多名单上多留一个人」。实际相反——认不出「AI 将会回复」那条，AI 回复就被算成真人，热线索被埋，正是本模块要消灭的错。已改正，并把 M3（每天扫没见过的文案）从锦上添花改述为这道判据的安全网。
W61-5：试跑探针入库 scripts/probe-wp2-human-reply.ts，否则复核日没东西可跑。入库后实跑一次，四个数字仍为基准值。
W61-2：四条 M1 的归属轮次已逐条写进 2026-09-26-wp2-ai-notice-table 那张卡。
