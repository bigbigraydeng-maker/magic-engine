---
id: 2026-10-05-ai-overview-detector-likely-broken
title: 「AI 概览」检测很可能是坏的（1676 条全 false），需拿到 DataForSEO 密钥发一次试探才能确认并修
status: done
owner: agent
decided_on: 2026-10-05
source: session:0e415fe6
verify_by: 2026-10-12
verify_how: 下次每周跑（10-12 前后）后查 serp_ai_overview_snapshots 新行 has_ai_overview 是否出现 true、引用来源非空；样本看全部新行
done_on: 2026-10-05
done_ref: pr:2242
last_checked: 2026-10-13
---
试探已跑（1 次，$0.002）：确认是解析写错，真实返回里 AI 概览正文在 items[].text、引用在顶层 references[]。
修复见 PR 2242（请求参数未改，调用量不变，B 级）。历史 1676 行仍是「没测到」，未回填。
是否开 load_async_ai_overview 待新数据再判。
