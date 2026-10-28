---
id: 2026-10-28-social-s1-s2-platform-tags-and-post-metrics
title: 社媒第一批：新工单必须写明平台和创意标签，并能按平台读单条帖子表现
status: done
owner: agent
decided_on: 2026-10-28
source: doc:docs/specs/2026-10-19-social-agent-capability-map-v0.3.md
verify_by: 2026-11-04
verify_how: 合并上线后查新建工单 brief 里 platform 带齐比例是否为 100%（按平台分别数）；再对 CTS 跑一次单条表现读取，确认读不到与 0 分开显示、n 标明；同时确认没有被拒收的信号是因为外部调用方没带平台
done_on: 2026-10-28
done_ref: pr:3347
---
S1 平台必填与创意标签、S2 只读表现读取，代码在本 PR，草稿状态等合并。
风险点：外部直接推信号的调用方若不带平台会被拒收，合并前要确认。
S2 只有 2026-09 的少量真实数据，属于先铺管道，不算已验证。
