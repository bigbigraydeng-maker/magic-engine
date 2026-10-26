---
id: 2026-10-14-factory-worker-single-mac-unmonitored
title: 出片工人只跑在一台 Mac 上，队列为空或挂了不到 6 小时没人知道（暂不做新监控）
status: decided
owner: agent
decided_on: 2026-10-14
source: session:450208a3
verify_by: 2026-10-21
verify_how: 到期时核对出片工人仍在上报（cron_run_logs 里 factory-worker-alive 最近一条在 10 分钟内），并看是否值得排「超 2 小时没上报报警」小改
---
现状：出片工人是那台 Mac 上开机自启的后台程序，每 30 秒上报一次存活；队列有活没人领约 6 小时后今日待办才冒报警。
盲点：队列为空时挂了无人知；报警要等约 6 小时。
18 号令暂停新功能，本卡只记录；建单前先查存活记录，超 10 分钟没更新先重启。
