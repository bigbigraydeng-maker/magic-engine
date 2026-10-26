---
id: 2026-10-26-stale-in-progress-cards-close
title: 执行看板上 30 天没人动的「进行中」卡片，每天自动收成「跳过」
status: decided
owner: agent
decided_on: 2026-10-26
source: session:9c08a71c
verify_by: 2026-10-29
verify_how: 合并后首次 seo-patrol-daily（每天 04:00 UTC）跑完，查它那一行 cron_run_logs 的 summary.hygiene.stale_in_progress：应是 closed 约 20（合并前实测 21 张进行中里 20 张超过 30 天）、没有 error；再查 execution_items 里 auto_run_error=stale_in_progress_30d 的行数等于 closed，且没有 completed 被误写。第二天 closed 应为 0 或个位数。
---
Grok Bot #3075-副 等价（原 PR 已关，决策见 2026-10-26-close-grok-cron-prs-rewrite-on-current-main）。
问题：「进行中」卡片没人碰也一直挂着，看板假装有活在做。Grok 原版是一个手动脚本；这里改成放进已在调度的 seo-patrol-daily 卫生步骤，不新增定时入口、不改 render.yaml。
修法：card-expiry.ts 新增 closeStaleInProgressCards，阈值是导出常量 STALE_IN_PROGRESS_DAYS（30），收成 skipped（不写 completed）并把原因写进 auto_run_error；SEO 每周清单卡（steps_json.loop）不碰。清理失败只记在自己的 stale_in_progress 字段，不拖垮其它卫生项。
注意：首次运行会一次性收口积压的旧卡；这些卡全是系统写的（计划 10、诊断 6、诸葛亮 4），没有员工手动认领的。
