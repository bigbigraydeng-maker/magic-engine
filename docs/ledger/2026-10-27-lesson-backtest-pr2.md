---
id: 2026-10-27-lesson-backtest-pr2
title: 经验验证 PR-2：广告只读回测（频次→CPM/CTR），其余一律无法回测
status: decided
owner: pm
decided_on: 2026-10-27
source: issue:3088
verify_by: 2026-10-31
verify_how: 在广告引擎页打开一条提到 frequency 和 CPM/CTR 的广告经验，选一个有广告数据的客户点"回测一下"，看到"支持/不支持/数据不够"和"只看相关性"；其他广告经验显示"无法回测"
---
只读 `ad_daily_insights`（meta、campaign 级、近 90 天），不调模型、不碰广告账户、不迁移、不写库。
关键词自动匹配回测规则（`lesson-verify/backtest.ts`），不让人手选；皮尔逊相关系数 |r|≥0.2 且方向对 = 支持，至少 30 条有效数据，否则数据不够。
已知缺口：只看相关性；不同广告系列混在一起算；限流为单实例内存计数；只支持两类规则，要加规则改 `backtest.ts`。
