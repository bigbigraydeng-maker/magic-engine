---
id: 2026-10-13-cts-reel-manual-promote-no-measurement
title: 已知缺口：工厂 Reel 先传草稿再转公开的，都接不上发后 4 小时和 72 小时的互动读数（不只是手工转公开的）
status: decided
owner: agent
decided_on: 2026-10-13
source: session:74f85b6e
verify_how: 下一条经系统公开的 Reel，先看到它有一条 social.publish_post 动作行且行上标着已公开，再看到 4 小时后有读数行；两件都看到才算这条链通了
---
10/14 查实（只读）：草稿上传时发布程序写过动作行（类型 factory_reel_publish），但行上记的是「草稿」和上传时间，转公开后这行不会更新。
读数接线会回读这一行，要求行上写着「已公开」且公开时间与事件一致，否则跳过，不登记 social.publish_post，所以没有任何读数。
因此根因在上游：线上是草稿模式时，无论自动还是手工转公开都接不上。CTS 的 social.publish_post 最后一行停在 9 月上旬。
证据见 docs/clients/cts/social-review/2026-10-patrol-log.md 的 10/14 一节。标题与判据于 10/14 按 74 号要求用 --allow-frozen 改过。
