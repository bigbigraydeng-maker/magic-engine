---
id: 2026-10-18-ads-metric-mismatch-already-covered
title: 「SEO 动作被广告指标打分」这条不单独修——74 号的排除建议类动作已覆盖；残留是手工记的动作行不过指标解析器，低频，只开卡
status: decided
owner: agent
decided_on: 2026-10-18
source: session:c668eb35
verify_by: 2026-10-25
verify_how: 74 号那刀合并后，查 flywheel_outcomes 里 action 带 payload.discovery_id 的行应不再新增结论；再查 flywheel='ads' 且无 discovery_id 的真执行动作有几条仍 expected_metric 为空，判断够不够格补代码
---
查库 120 天：flywheel='ads' 共 35 行，27 行带 discovery_id（发现环节的建议，74 号的修复会整个排除评估，连带修掉 fix_broken_internal_links 被广告线索成本判 confirmed 那条）。
剩 8 行是真执行过的，其中 7 行 expected_metric 为空：播放量系列的空值是 ads-expected-metric.ts 刻意设计（视频/触达类没有结果指标，宁缺不错）；
但 WhatsApp 改预算那条按目标应得 cost_per_conversation，它是窗口手工记的行、没走 execute 路由，因此没过指标解析器。
残留缺口=手工记的动作行绕过解析器，120 天约 1 条，按「谁发起/有几条/人真每周撞上吗」三条不过，只开卡不补代码。
详见 docs/specs/2026-10-18-ads-agent-whole-design-and-code-gaps-v0.1.md。
