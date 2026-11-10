---
id: 2026-11-04-social-prepublish-fact-recheck
title: 社媒发布这一环第一刀：Reel 公开前用当前团目录再核一次事实（转公开 / 补首评 / 真发三处）
status: decided
owner: pm
decided_on: 2026-11-04
source: pr:3571
verify_by: 2026-11-07
verify_how: 合并部署后，对一条 CTS 已过审的 Facebook 草稿片调一次转公开「预览」（只预览不确认），返回里有 fact_check（目录版本 13、结论、最多 3 条对不上的项）；对 Natural China 旧片（写 16 天 / $7,349）预览应被拦下（422，原因写明天数与价格）；没有团目录的客户预览照常、显示「不适用」
---
设计 docs/specs/2026-11-04-social-publish-step-design-v0.2.md（子牙、魏征设计复审各 4 条必改已并入）。每周闭环与发布侧共用一份核对规则 checkReelFacts（weekly-loop/reel-facts.ts）；转公开预览与确认、补发首评（只核首评）、发布 worker 真发分支都在公开前重核，只有通过或「这位客户没有已发布团目录」才放行，读不到目录一律拦；已被人手动公开的片只同步记录并告警。目录版本进转公开指纹，预览后目录换版须重新预览。魏征 11-04 用生产数据实测：CTS 现有 24 条草稿按目录第 13 版重核，14 条放行、10 条拦下，被拦的全是真过期。
