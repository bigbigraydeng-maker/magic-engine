---
id: 2026-10-18-factory-draft-not-recorded-as-sent
title: 工厂只上传到 Facebook 草稿的 Reel，不能被记成已发布
status: decided
owner: agent
decided_on: 2026-10-18
source: session:c45254ff
verify_by: 2026-10-25
verify_how: 合并后，下一次工厂发出 Facebook 草稿之后，查那条工单：流量记录（flywheel_actions，factory_reel_publish）有 1 行且 payload.video_state 为 DRAFT；没有新增「工厂自动发布 Reel」的已完成待办；工作日志写的是「草稿已上传…未公开」。至少看到 1 条新草稿才能判成。
---
改动：草稿期仍写流量记录（转公开动作要靠它），但不再写已完成待办、日志改成「草稿已上传，未公开」；真公开行为不变。
后续事项 1（PM 决定）：改动之前已写入的 11 条草稿动作行和 19 条日志，里面有误写成「已发」的，要不要清理；本卡不动它们。
后续事项 2：转公开那一步（另一个 PR）目前不会补写「已完成待办 / 已发日志」，需要的话由转公开 PR 补，本 PR 不碰。
