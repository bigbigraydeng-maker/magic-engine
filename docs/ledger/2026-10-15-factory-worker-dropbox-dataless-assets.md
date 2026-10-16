---
id: 2026-10-15-factory-worker-dropbox-dataless-assets
title: 出片机素材目录里的大片段会被 Dropbox 转成「仅云端」，出片时报「缺少素材文件」（文件其实没丢）
status: decided
owner: agent
decided_on: 2026-10-15
source: session:450208a3
verify_by: 2026-10-22
verify_how: 做法 A（出片机读取前先唤醒文件并重试一次）合并后，把一个素材改成仅云端再建单，确认能出片；或确认 Dropbox 已对该目录设「始终保留在本机」
---
2026-10-15 Panorama 工单 1f2b1f3b 进死信：「缺少素材文件 c4_westlake_pavilion / v3_bund_night_zoom」，实查两个文件在目录里，但被标成 dataless（Dropbox 仅云端）；出片机复制时任何错误都被当成「缺少」。
当天已把素材目录里 14 个仅云端文件全部读回本机；根治要么出片机读前先唤醒并重试，要么该目录设为始终保留本机。
