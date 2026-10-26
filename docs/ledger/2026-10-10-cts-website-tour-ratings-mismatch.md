---
id: 2026-10-10-cts-website-tour-ratings-mismatch
title: CTS 官网六个团卡片上的评分和评价数，与官网自己登记的谷歌核实值对不上；PM 2026-10-10 决定先跳过
status: decided
owner: pm
decided_on: 2026-10-10
source: session:1a85e0eb
verify_how: 官网团卡片上显示的评分与评价数，要么有可核对的来源，要么已不再显示
---
事实（chinatravel 主干团数据，2026-10-10 读取）：Silk Road 4.8 分 127 条、Legacy of China 4.9 分 283 条、China Panorama 4.7 分 94 条、Natural China（16 天）4.6 分 156 条、A Tale of Two Cities 4.8 分 312 条、Japan Cherry Blossoms 4.9 分 0 条。团卡片文案写死为「N Google reviews」。官网代码另有登记的谷歌核实值：4.4 分、12 条（`src/lib/data/google-rating.ts`，2026-08-30 人工核实），该文件注释自己写明对外宣称高于实际的第三方评分在新西兰属于误导性表述。这些数字的来源未核实，是否来自其它平台或早期占位需问 CTS。
PM 决定：先跳过，不清空、不去问。现状：团目录按原样读入这六个团的评分，只有 Magic Engine 全局管理员能改，改动在上架对照表里算高风险。官网上现在显示的数字没有动。
之后要处理时：问 CTS 数字来源 → 有来源则把来源写进团目录备注；没有则在官网代码与团目录里一并清空。
