---
id: 2026-11-24-cron-run-logs-cleanup-batch
title: 运行记录清理改成分批删，避免每天清理任务超时
status: done
owner: agent
decided_on: 2026-11-23
source: pr:3926
verify_by: 2026-11-25
verify_how: 合并并部署后，看下一次 cron-run-logs-cleanup（每天 16:50 UTC）的 summary。不再出现 statement timeout，且 purged_noise、purged_expired、remaining、stopped_early 有数。未合并或未部署就写前提未满足，不要判失败。
done_on: 2026-11-24
done_ref: pr:3926
---
11-20、11-21、11-23、11-24（UTC）连续 statement timeout，purged_expired 一直为 0。表约 10 万行，最老约 07-07，还没到 180 天硬删。
改法：应用层每批 3000 行、约 95 秒预算；删不完就停并记下 remaining，次日继续。保留规则没改。
本机只跑了清理路由的单元测试，没有打生产 cron，也没有写生产库。见 pr:3926。
