---
id: 2026-10-27-qibaishi-sales-progress-style-second-job
title: 齐白石第二单：销售进度表加卡片容器与手机滚动
status: done
owner: agent
decided_on: 2026-10-27
source: pr:3285
done_on: 2026-10-27
done_ref: pr:3291
verify_how: 上线后在手机宽度打开销售进度页，确认整页不再被撑破、超订显示 ME 红；数据问题（过期出发日仍显示剩余、部分团未设上限）另查
---
只改 SalesProgressTable.tsx 的样式类名，前后检查记录在 PR 3291 正文。
过期出发日仍显示剩余座位、部分团上限未设置，属于数据问题，未在本次范围。
