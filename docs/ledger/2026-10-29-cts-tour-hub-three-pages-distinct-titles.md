---
id: 2026-10-29-cts-tour-hub-three-pages-distinct-titles
title: CTS 官网首页和两张卖团页原本同一个标题，已拉开（全部团目录 / 含机票套餐），看卖团词名次有没有往前
status: decided
owner: agent
decided_on: 2026-10-29
source: session:2cd3c621
verify_by: 2026-11-28
verify_how: 一、curl https://www.ctstours.co.nz/china-tours 的 title 含 "Compare Routes, Prices"，/china-tours-from-new-zealand 的 title 含 "Airfare Included"，首页仍是 "China Tours from New Zealand"。二、keyword_snapshots 里 CTS 的 china tours（10-26 第 10 名）、china tours packages（第 12 名）、china tour packages、china holiday packages 至少一个比 10-26 前进 3 名以上算有效；都在 3 名以内算没变化；快照缺这几个词算没测成。不看点击率（小流量站噪音大）。
---
PM 10-29 在对话里看过改前改后回「合」。官网仓库 chinatravel 第 278 号改动单，合并提交 898ef4576。
改前：三页标题都是 China Tours from New Zealand；/china-tours 与 /china-tours-from-new-zealand 的 H1 也相同。
依据：近 60 天 GSC 词级数据显示三页本来各赢不同的词（首页赢 china tours from nz 第 3.6 名；含机票页赢 packages including airfare from nz 第 4.3 名；目录页赢 china tour package 第 5.3 名）。
顺带查实：李子坝三页合并 10-13 已上线（官网第 241 号），签证页已有 6 处卖团链接，这两条不用再做。
