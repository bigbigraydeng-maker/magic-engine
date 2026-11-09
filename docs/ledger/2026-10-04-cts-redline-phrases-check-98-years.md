---
id: 2026-10-04-cts-redline-phrases-check-98-years
title: 查 CTS 的品牌禁用词名单里有没有 98 years，没有的话要不要加（这是改生产客户数据，需 PM 决定）
status: decided
owner: pm
decided_on: 2026-10-04
source: session:6b59f1ad
verify_by: 2026-10-11
verify_how: 读 CTS 在客户表里的禁用词字段，看是否含 98 years 与 since 1928 一族；含则本卡完成，不含则 PM 决定是否加。名单读到之前，不得声称私信广告的红线已拦住 98 years
---
PM 规则：since 1928 或 98 years 不能单独成句，只能和 25 年新西兰成对出现。
代码里的机制是命中禁用词即拒，成对例外表达不了，所以更保守：文案用 25 年新西兰的说法即可绕开。
本窗口没有读生产库，也不会改客户数据。
