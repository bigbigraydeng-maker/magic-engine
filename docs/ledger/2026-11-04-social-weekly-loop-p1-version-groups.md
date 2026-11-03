---
id: 2026-11-04-social-weekly-loop-p1-version-groups
title: 社媒每周闭环 P1：版本归组 + 新版本不继承发布日期
status: done
owner: agent
decided_on: 2026-11-04
source: pr:3571
done_on: 2026-11-04
done_ref: pr:3574
verify_by: 2026-11-18
verify_how: 合并后 npx vitest run src/lib/social/weekly-loop/__tests__/version-groups.test.ts src/lib/factory/variant-order.test.ts src/lib/factory/review-apply.test.ts src/lib/factory/review-sync-reject.test.ts 全绿；第一阶段试跑时用 CTS 真工单跑 groupVersions，5 条已知旧版本被归进同组
---
设计 v1.1 §2 ① 与 §2.3 的第一块：groupVersions 纯函数（变体 / 重开 / 片里字幕相同归组，留最新，判不清报 ambiguous）；变体复制与两处打回重开剥掉 brief.weekly_pack。不发布、不改库结构。
