---
id: 2026-10-21-list-template-faster-reveal-small-text
title: 出片机清单模板第三次小调：价格卡更快出齐、整体上移、字号放大、片尾标题可缩字
status: done
owner: agent
decided_on: 2026-10-21
source: pr:2971
done_on: 2026-10-21
done_ref: pr:2971
verify_by: 2026-10-28
verify_how: 出片机升级后用上海的 SH5 和 SH6 两张工单各渲染一条，看三件事。价格卡 0.5 秒内出齐，没有出到一半的字；底部 FLIGHTS INCLUDED 的下边不超过 1190；片尾标题 SHANGHAI & SURROUNDINGS 一行放得下。另外已有的清单工单还能照常出片。
---
来自 74 号 10-21 的决定，原因是第二轮独立质检看到转场有残影或被裁、离安全线太近、小字偏小。
这次只动清单（list）模板：价格卡的出场动画延迟缩短，价格卡和片尾标题整体上移 40 像素，右下角版式的起价数字和脚注放大到 40，片尾标题新增一个可选的字号参数。
明信片（postcard）模板共用同一个价格场景，它的动画和字号默认值保持不变。
