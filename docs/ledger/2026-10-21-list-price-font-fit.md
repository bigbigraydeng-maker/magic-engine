---
id: 2026-10-21-list-price-font-fit
title: 清单模板价格字号自适应：8 个字符的价格（如 NZ$3,480）放小一点，保证价格框不超出右边安全距离
status: decided
owner: agent
decided_on: 2026-10-21
source: doc:docs/ledger/2026-10-21-list-template-faster-reveal-small-text.md
verify_by: 2026-10-28
verify_how: 合并并升级出片机后，用 Tale 新版（价格 4 位数）渲染一次：价格框右边距≥60px；已有 list 工单（价格 NZ$7,349 等）仍能出片、字号只缩小约 6%；postcard 的价格卡字号不变（引擎 node --test 全过）
---
独立质检（Tale 新版）测出价格框右边距只有约 45px（<60）：8 字符价格在 170px 字号下框宽约 945px 超出 900 可用宽。新增纯函数 priceFontSizeFor(prefix, amount, fit)，只有 list（fastReveal）用「7.5 字符」阈值，postcard 沿用旧的 9 字符阈值，行为不变。
