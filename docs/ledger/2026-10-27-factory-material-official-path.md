---
id: 2026-10-27-factory-material-official-path
title: 处方同意后只出素材，死信有限重跑，待审超时只写待办
status: done
owner: agent
decided_on: 2026-10-27
source: issue:3239
verify_by: 2026-10-30
verify_how: 合并后第一次自动跑，或用 dry_run=1 打这一条。cron_run_logs 里有 factory-dead-letter-rerun。点名不重跑的两张工单状态不变。待审催办只出现在今日待办，没有新的对外消息。
done_on: 2026-10-27
done_ref: pr:3259
---
处方同意后走已有的新推广信号，只做素材，不批准、不入池、不改发布开关。
缺文件或渲染工人离线最多自动重跑两次；文件太大先等体积补丁，不重跑。
失败原因读不到写成「读不到」，不当成功。待审满 24 小时只写今日待办。
依赖成片体积补丁那个草稿，合并前不要对生产死信真跑。
