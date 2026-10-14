---
id: 2026-10-14-cts-reel-draft-first-no-measurement
title: 已知缺口：工厂 Reel 先传草稿再转公开的，都接不上发后 4 小时和 72 小时的互动读数（不只是手工转公开的）
status: decided
owner: agent
decided_on: 2026-10-14
source: session:74f85b6e
verify_how: 下一条经系统公开的 Reel，先看到它有一条 social.publish_post 动作行且行上标着已公开，再看到 4 小时后有读数行；两件都看到才算这条链通了
---
根因（10/14 只读查实）：草稿上传时写了一行动作记录（factory_reel_publish），上面记的是「草稿」，转公开后从不回写；读数接线看到「草稿」就跳过，不登记 social.publish_post。
已公开的 4 条 Reel，发后 4 小时和 72 小时两个时点的历史读数补不回来，接受损失；改那 4 行属于改已有数据，未获 PM 点头前不动。
同根的两处记录不准，只记录不改：上传成草稿当天工作日志就写了「已发到」；其中一条的渠道名写成了别的客户。
取代旧卡 2026-10-13-cts-reel-manual-promote-no-measurement。证据见 docs/clients/cts/social-review/2026-10-patrol-log.md 的 10/14 一节。
