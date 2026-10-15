---
id: 2026-10-15-documentary-series-winter-workspace
title: 系列视频与Winter选题接入内容工厂，数据连接待上线验证
status: done
owner: agent
decided_on: 2026-10-15
source: doc:docs/tasks/2026-10-15-documentary-series.txt
done_on: 2026-10-15
done_ref: pr:2694
verify_by: 2026-10-16
verify_how: 上线后核对有权客户的系列与已关联视频真实计数，其他客户不得显示该配置，过期编辑拒绝覆盖。
---
本地实现已完成，新增Winter选题、系列筛选、成片链接和公开播放计数。
复用内容工厂、客户配置和既有视频数据读取；不改发布或平台授权。
本地测试与双审证据见任务说明；尚未合并部署、未写生产客户数据。
平台数据权限及成片托管需上线时核实，不把空值报告为零播放。
封面已补齐并接入本地卡片：沿用上海，新增常规和Winter草稿，来源授权随素材保存。

2026-10-15 production evidence: original feature merged in PR #2680 and is now live; authenticated dashboard shows 12 episode plans and covers. Shanghai linked to https://www.youtube.com/watch?v=xJld_NaRQBU via existing UI, with successful actual public counter read. Local Chongqing/Zhangjiajie review files are not hosted previews.
Follow-up cover correction: replace suspected Shanghai gazebo photo incorrectly used as Hangzhou backdrop with source-labelled Leifeng Pagoda frame (Pexels 39955168, LayG Traveller); same locked template and three image sizes. Static asset/attribution change only; no application tests/build locally. Source and image QA recorded in authoritative task.
