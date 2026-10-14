---
id: 2026-10-14-east-video-factory-wiring-plan
title: East Inter 出片接线：只剩出片机本机名单加 East 并重启（其余已完成）
status: decided
owner: agent
decided_on: 2026-10-14
source: session:9cbc0338
verify_by: 2026-10-16
verify_how: PR 2646 合并后，看出片机本机名单（FACTORY_REMOTION_CLIENT_IDS 与 FACTORY_CLIENT_STUDIO）是否已加 East 并重启；没加就提醒 18 号
---
已完成：数据卡代码接线（PR 2646）、East 品牌包（Dropbox East_Inter/brandkit）、East 红线词 22 个（见 2026-10-14-east-redline-phrases-added）。未完成：出片机本机 `.env` 里把 East（client_id 2e3f040d-4497-4527-89f6-50b6fa91e205）加进 FACTORY_REMOTION_CLIENT_IDS，并在 FACTORY_CLIENT_STUDIO 映射到 East_Inter，然后重启出片机——这步不在仓库里，要 18 号/PM 在出片机上做。没出片。详见 docs/clients/east-inter/2026-10-14-east-video-factory-wiring-plan.md。
