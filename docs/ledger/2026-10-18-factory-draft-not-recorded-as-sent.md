---
id: 2026-10-18-factory-draft-not-recorded-as-sent
title: 工厂只上传到 Facebook 草稿的 Reel，不能被记成已发布
status: decided
owner: agent
decided_on: 2026-10-18
source: pr:2817
verify_by: 2026-11-07
verify_how: 合并后下一条工厂草稿：流量记录有 1 行且 video_state 为 DRAFT；没有新增「工厂自动发布 Reel」的已完成待办；工作日志写「草稿已上传…未公开」。看到 1 条新草稿即可。
---
草稿仍写流量记录（转公开要靠它），不写已完成待办，日志写「草稿已上传，未公开」。只有 Meta 回读确认公开才写「已发到」并登记发后读数。
后续（Ray 定）：改动之前已经误记成已发的历史行，这次不清理。
转公开成功后的已完成待办和工作日志，走已经在主干上的转公开回执，本卡不改那条路径。
