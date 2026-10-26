---
id: 2026-10-12-factory-order-reel-promote-entry-missing
title: 工厂主线工单的草稿 Reel 没有自动转正入口（转正函数已修好，但没人调用）
status: decided
owner: agent
decided_on: 2026-10-12
source: session:7c3226a9
verify_by: 2026-10-19
verify_how: 查是否有人认领并开出 PR：工单（content_work_orders）草稿 Reel 的转正入口，需同时处理首评补发、published_ref.video_state 同步为 PUBLISHED、me/factory.reel.published 发布信号（会触发下游起草暂停广告，先确认广告自动化开关）。未开工则把这条提给 PM 排优先级
---
PR 2452 已合并，promoteReelToPublished 现在能用，但目前只有讲课片会调用它。工厂主线（factory-publish-worker）在没开真发开关时只传草稿，之后没有任何自动转正步骤，只能像 CTS 上海 Reel 那次靠人手动转。
A 级：碰对外发布。需先定转正由谁授权（PM 逐条点 / 每客户开关）。
