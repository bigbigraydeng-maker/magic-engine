---
id: 2026-10-24-viral-analyzer-retry-loop
title: 爆款视频分析失败后要换下一条，不能把失败记成成功
status: done
owner: agent
decided_on: 2026-10-24
source: doc:src/app/api/cron/viral-analyzer-worker/route.ts
verify_by: 2026-10-27
verify_how: 先把这次的数据库迁移应用到库，再部署新代码。之后看定时任务记录：失败条数要等于这次没分析成的条数；小红书和违规内容变成不再重试，不能再被同一批重复领取。
done_on: 2026-10-24
done_ref: pr:3074
---
分析队列以前总是重跑最早的几条错误，而且失败被记成成功。
永久失败改为不再重试；暂时失败按次数往后推，并按最近更新时间轮流处理。
发现和手工导入会丢掉下载器处理不了的小红书链接。
迁移文件已放进仓库，还没有应用到生产库。要先应用迁移，再部署新代码。
