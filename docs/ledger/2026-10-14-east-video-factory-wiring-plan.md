---
id: 2026-10-14-east-video-factory-wiring-plan
title: East Inter 出片接线：只剩出片机本机名单加 East 并重启（其余已完成）
status: done
owner: agent
decided_on: 2026-10-14
source: session:9cbc0338
verify_by: 2026-10-16
verify_how: PR 2646 合并后，看出片机本机名单（FACTORY_REMOTION_CLIENT_IDS 与 FACTORY_CLIENT_STUDIO）是否已加 East 并重启；没加就提醒 18 号
done_on: 2026-10-15
done_ref: pr:2646
---
已完成：数据卡代码接线（PR 2646，已合并）、East 品牌包（Dropbox East_Inter/brandkit）、East 红线词 22 个、线上允许名单含东际、出片机心跳含 CTS+Oztop+东际。真实验证：东际试跑工单 6403582c 于 2026-10-15 12:24Z 出片成功进审核队列（见 2026-10-15-east-trial-video-a-done-b-pending）。卡住过 30 分钟的原因是出片机开机自启文件里写死「只领 CTS」，后被别人改掉。
