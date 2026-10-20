---
id: 2026-10-21-list-template-transition-and-sizes
title: 清单模板再小改：价格卡出场加快、整体上移 40px、小字下限 40、片尾标题字号可调
status: done
owner: agent
decided_on: 2026-10-21
source: session:106
verify_by: 2026-10-28
verify_how: 合并并升级出片机后，用上海 SH5/SH6 工单渲染：价格卡 0.5 秒内出齐（无半截字）、FLIGHTS INCLUDED 底边≤1190、标题「SHANGHAI & SURROUNDINGS.」一行放下；已有 list 工单仍能出片（引擎 node --test 525 过）。74 号 10-21 决定（独立质检第二轮：转场残影/被裁、离安全线太近、小字偏小）
---
PriceScene 出场动画延迟 14/22/28 帧改为 4/7/10；ListReel 价格卡 top 700→660、片尾标题 top 596→556；corner 版式 FROM 字号 34→40；脚注默认字号 30→40；新增可选 `revealTitleSize`（36–60，默认 60，给长标题缩字用）。全部行为由 `PriceScene` 的新参数 `fastReveal` 控制，只有 ListReel 传入；postcard 共用 PriceScene 时默认值与动画不变（延迟 14/22/28、脚注默认 30、corner FROM 34）；list 的脚注默认字号 40 由 ListReel 传入。
