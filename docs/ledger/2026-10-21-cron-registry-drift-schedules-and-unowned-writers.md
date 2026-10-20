---
id: 2026-10-21-cron-registry-drift-schedules-and-unowned-writers
title: 自动任务登记表与 render.yaml 对不上：7 个任务的运行时间写错、3 个写运行记录的函数没登记，仓库自带的对账测试在主干是红的
status: decided
owner: agent
decided_on: 2026-10-21
source: session:ec90bb17
verify_by: 2026-10-28
verify_how: 主干上 src/lib/cron/registry.test.ts 全绿（「调度表达式跟 render.yaml 一致」和「调了 startCronRun 就必须在清单里或白名单里写明原因」两条）；后台自动任务健康页对这 7 个任务不再按错的间隔误报或漏报；3 个未登记的函数（每日计划自动发布、Reel 批量渲染、Story 轻量发布）已进入监控清单，或在白名单里写明为什么不排班；故意改坏任一边，对账测试会变红。
---
2026-10-21 74 号转述 122 号发现：登记表里广告设置快照写每 3 小时，render.yaml 实际每 6 小时。统管跑仓库自带对账测试后发现不止这一个：主干上 src/lib/cron/registry.test.ts 有 2 条是红的（GitHub 检查被账单锁住没人看到）。
调度写错 7 个：ad-entity-snapshot（登记 30 */3，yaml 30 */6）、ai-tracker-weekly（登记 0 1 * * 1，yaml 0 18 * * 0）、goal-current-value-refresh（登记 0 3 * * *，yaml 30 17 * * *）、google-data-pullback-daily（登记 0 3 * * *，yaml 0 17 * * *）、meta-leads-hourly（登记 25 * * * *，yaml 25 */2 * * *）、prospecting-sweep（登记 */30 * * * *，yaml 0 * * * *）、social-comment-autoreply（登记 */30 * * * *，yaml 0 * * * *）。
写了运行记录却没人认领的 3 个：daily-plan-auto-publish、reel-batch-render、story-lite-publish（都在 src/lib/inngest/functions/）。
为什么要紧：健康检查靠登记表判「该跑没跑」，写错间隔就会误报或漏报；没登记的函数「不在监控范围」和「一切正常」在告警里长得一样，其中两个还是发布类。
修法方向：以 render.yaml 里实际在跑的为准对齐登记表（yaml 本身写错的另说），3 个函数补登记或写白名单原因；render.yaml 里 ad-entity-snapshot 上方「每 3 小时」的注释一并改。改登记表属 A 级（机器判 A），走草稿、两审、PM 本人「合 N」。派 122 号窗口（Inngest 监督）。
