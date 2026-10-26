---
id: 2026-10-18-cts-reels-published-but-draft
title: CTS 11 条成片做好了却还是 Facebook 草稿没公开；10/22 开投真正卡的是那 3 条正确候选批准数为 0，不用写代码
status: decided
owner: pm
decided_on: 2026-10-18
source: session:c668eb35
verify_by: 2026-10-21
verify_how: 查 content_work_orders 里 CTS status in (published,measuring,closed) 且 published_ref->>platform='facebook' 的行，按 published_ref->>video_state 分组；今天基线 DRAFT 11 / PUBLISHED 4 / null 1。再看 ad_strategy_configs.creative_pool 里那 3 条 15 秒价格悬念片是否已 status=approved（今天 0 条批准）
---
10-18 查生产库查出来的，不是推断：CTS 真正公开发出去的 Facebook Reel 只有 4 条，其中 3 条（三个团各一条 15 秒价格悬念片）正是素材池里已有的 3 条候选，人手填得对。
另外 11 条 status='published' 的其实 video_state='DRAFT'，没公开——归 97 号「Reel 转公开」那条线，不是广告线。
所以 10/22 开投的卡点是批准数 0（PM 在广告健康页点一下即绿），不是素材登记。
