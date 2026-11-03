---
id: 2026-11-03-factory-studio-mirror-auto-sync
title: 出片机读的本机素材镜像改成每 5 分钟自动从 Dropbox 补齐（只补不删），不再靠人手抄
status: decided
owner: agent
decided_on: 2026-11-03
source: session:369fcc9e
verify_by: 2026-11-10
verify_how: 合并后装上定时任务（scripts/factory-worker/launchd/README.md「素材镜像自动同步」），再跑 node scripts/factory-worker/tools/sync-studio-mirror.mjs --check：退出码 0 算成；同时看 ~/Library/Logs/magicengine-studio-mirror-sync.log 最近一条 studio_mirror_sync 记录 failed 为 0、时间在 10 分钟内。没装就判不了，交 PM 决定装不装。
---
起因：PM 要求查清 ME 素材怎么管、怎么读。实查出片机读 ~/Library/Application Support/magicengine/studio，比 Dropbox 少 21 个文件（CTS 5 段片段、8 首配乐等），当天另一张单因此失败两次。
本卡只管出片机镜像。另外两处没动：入库打标签工具只在本机一个未提交的目录里；自动入库只监听旅游行业收件箱，CTS 收件箱 4 批素材没进目录；ME 后台读的是 client_assets 表，新素材库的云端存储没有任何代码在读。
