---
id: 2026-11-05-factory-itinerary-city-guard
title: 工厂新闸「行程城市核验」：旅游团广告片进待审前，确定性核对片中声明城市是否都在该团官网行程里，不对就拦（不用视觉猜画面）
status: decided
owner: agent
decided_on: 2026-11-05
source: doc:docs/specs/2026-11-05-factory-itinerary-city-guard-design-v0.md
verify_by: 2026-11-19
verify_how: 刀 F-1 落地后：对现役 Shanghai & Beyond 逐段文字（Suzhou gardens/Wuxi canal/Bund，授权城市上海苏州无锡杭州）跑 verifyItineraryCities 应全 PASS；塞「长城/兵马俑」同清单应 BLOCK；映不出的地名或缺授权清单应 FLAG 不硬判。三例为确定性单测，当场可跑
---
PM 2026-11-05 核现役广告时提出。方向定死为确定性文字闸，禁止视觉判断（shot-guards 已记该教训）。授权城市取自 ME Tour 目录 tour_cities；逐段文字工厂自产可得、外部上传只有 caption/angle（像素城市靠马良+人审兜底）。Tier：机制 L1、地名表 L2 行业、城市清单 L4 客户。风险 B，无库表改动。分三刀交 DeepSeek 写。开工前每刀要 PM 点头。
