---
id: 2026-11-15-week-plan-keep-scheduled-reels
title: 重建周计划卡时带上这一周已经排好的 Reel
status: done
owner: agent
decided_on: 2026-11-15
done_on: 2026-11-15
done_ref: doc:src/lib/social/weekly-draft/reel-lines.ts
source: pr:3859
verify_by: 2026-11-22
verify_how: 同一客户下一轮写库回执里新排的 Reel 是 0 时，周计划卡仍列出目标周已经排好的 Reel。读不到已排名单时这张卡标未完成。
---

后一次成功的写库只带回这次新排的 Reel。周计划卡改为合并目标周里已经写上日期的工单，再写卡。
读不到这份已排名单时，卡上标未完成，不用残缺名单假装这一周只有新排的几条。
