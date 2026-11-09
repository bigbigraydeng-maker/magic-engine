---
id: 2026-11-02-ads-health-entity-tree-running-filter
title: 广告健康「每条广告」树默认只看在投，广告组内改表格排版
status: done
owner: agent
decided_on: 2026-11-01
done_on: 2026-11-02
done_ref: pr:3501
source: pr:3501
verify_how: 合并部署后打开广告健康「每条广告」：默认只看在投，网址带 show=running；在投系列下已停广告组/广告折叠为「另有 N/M（点开看）」，状态不明仍显示；切全部与改前一致；快照行含明早 01:30 说明
---
需求④：只读前端，仍用 ad-health/entities。顶部只看在投/全部写入网址；在投系列藏 stopped 层级并汇总提示；广告组内广告对齐表格，漏斗三指标默认收起、相对赢家大偏差标色。不调 Meta、不改库表。
