---
id: 2026-09-25-blog-exclude-failed-ai-probes
title: blog 模块读 AI 可见度数据时过滤掉失败的探测，不再把解析失败当成"可见度差"
status: done
owner: agent
decided_on: 2026-09-25
source: session:18eda50c
done_on: 2026-09-25
done_ref: pr:1946
---
page-seo-intelligence.ts 和 topic-selector.ts 读 ai_visibility_runs 时没过滤 error_message / parse_error_message，
导致解析失败的探测（client_brand_rank 为 null）被当成"品牌没被提到"，虚增 GEO gap 信号数量。
用共享谓词 isRunConclusive 过滤，两个消费方都只统计真正跑成功的探测结果。
