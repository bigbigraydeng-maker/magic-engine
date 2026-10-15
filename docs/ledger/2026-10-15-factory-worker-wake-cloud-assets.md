---
id: 2026-10-15-factory-worker-wake-cloud-assets
title: 出片机读素材前先唤醒 Dropbox 仅云端文件，并把「缺失」与「读不出来」分开报
status: decided
owner: agent
decided_on: 2026-10-15
source: pr:2679
verify_by: 2026-10-22
verify_how: PR 合并且出片机升级后，出片日志里不再出现把仅云端文件报成「缺少素材文件」；人为把一个素材转成仅云端再建单，能自动唤醒并出片
---
Panorama 工单 1f2b1f3b 因两个素材被 Dropbox 转成仅云端而进死信，错误被报成「缺少素材文件」。
修法在出片机代码里（唤醒 + 最多 2 次重试 + 每次 60 秒上限）；在 Dropbox 里设「始终保留在本机」只是可选的额外保险，不做也不影响。
