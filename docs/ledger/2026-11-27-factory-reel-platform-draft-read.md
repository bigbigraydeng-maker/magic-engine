---
id: 2026-11-27-factory-reel-platform-draft-read
title: 工厂 Reel 草稿先让读取认「草稿未公开」，还不改库、还不改发布写入
status: decided
owner: agent
decided_on: 2026-11-27
source: session:ffa96d95
verify_by: 2026-12-04
verify_how: 合进读侧兼容后，用测试数据看周计划和工厂看板：status 为 platform_draft 的工单不会被当成没有，也不会进「已发布」一组；旧的 published 加草稿标记仍按原样显示。库约束还没放宽，生产库看不到这个状态，那时写「判不了」
---
Ray 批准先写读取兼容，不动数据库、不改发布时写入的状态。转公开时改成已发布留到后面的改动。
处方周检把这个新状态算进「在做」，不叫「已发出」。发布补发对账仍只扫已发布，这次没改发布程序。
