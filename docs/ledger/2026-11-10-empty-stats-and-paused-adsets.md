---
id: 2026-11-10-empty-stats-and-paused-adsets
title: 追踪检查空统计和全暂停账户不再误报故障
status: done
owner: agent
decided_on: 2026-11-10
source: pr:3493
verify_by: 2026-11-12
verify_how: 事件统计空响应显示灰字「读不到数据，判不了」且计划仍不能批；广告组全暂停显示「全部暂停」，不是读不到。
done_on: 2026-11-10
done_ref: pr:3743
---
空统计不是零次。读到明确的 0 仍是红。灰和红一样挡住批准。
全暂停的旧口径见 pr:3185。两处都改现有判定，不新开表。
