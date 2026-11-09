---
id: 2026-11-04-social-weekly-loop-p5-schedule
title: 社媒每周闭环 P5：Reel 排期 + 带闸的发布日期写入
status: done
owner: agent
decided_on: 2026-11-04
source: pr:3571
done_on: 2026-11-04
done_ref: pr:3578
verify_by: 2026-11-18
verify_how: 合并后 npx vitest run src/lib/social/weekly-loop 全绿；第一阶段试跑时对 CTS 用 dryRun 跑一次 writeReelSchedule，返回的拟排期每周 3 条、同一团不相邻、线上工单 brief 无任何改动
---
设计 v1.1 §2 ④ / §2.3：planReelSchedule 纯函数 + writeReelSchedule 带闸写 brief.weekly_pack.publish_on（卡已开整周不写、已公开 / 有转公开记录 / 非审过草稿 / 已排过一律拒绝、乐观锁、出错即拒绝、dryRun 只读）。
