---
id: 2026-10-05-ai-overview-detector-likely-broken
title: 「AI 概览」检测很可能是坏的（1676 条全 false），需拿到 DataForSEO 密钥发一次试探才能确认并修
status: decided
owner: pm
decided_on: 2026-10-05
source: session:0e415fe6
verify_by: 2026-10-12
verify_how: 用现有封装发 1 条只读 SERP 试探，看真实返回里 AI 概览条目的结构；对上解析代码后修并加真实样本测试
---
读码结论：src/lib/dataforseo/serp.ts 按嵌套 ai_overview 字段解析（现有测试的样本是自编的），且请求没带 load_async_ai_overview。
这个窗口没有 DataForSEO 密钥，试探未跑；在确认前，该列按「没测到」处理，不得当作「没有 AI 概览」。
下一步：PM 在窗口里提供密钥后发一次试探（约 0.002–0.006 美元），改动按 A 级走。
