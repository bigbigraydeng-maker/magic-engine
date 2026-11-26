---
id: 2026-11-10-distributor-commission-same-formula-all-purchases
title: 代理销售分润制度（PM 11-10）：零售 20/30/35% + 平级 5% + 团队级差 6%~16%，客户不管买哪档套餐或加购，都按实付金额套同一公式；不考虑 ME 留多少
status: decided
owner: pm
decided_on: 2026-11-10
source: session:e5aca2ac
verify_how: 主干上 src/lib/distributor 的测试全过，且设计稿第 2 节 A→B→C 例子（C 3,600 / B 9,200 / A 1,600）被测试逐数核对；数据库表要等 Ray 亲手 apply 后才算上线
---
设计稿：docs/specs/2026-11-10-distributor-commission-system-v0.1.md；第一刀（计算核心 + 表设计，未上线）PM 11-10 回「开始」。
价格（PM 11-10）：799 日常促销价、999 标准价；每月视频 6 条 399 / 16 条 799 / 30 条 1,299 / 60 条 2,199。
数字人（PM 11-10）：每档含 3 个，多 1 个一次性加 100，同样套分润公式；客户可单独加购。
PM 11-10「不用考虑我们留多少」：不设 ME 留存底线，最坏单笔发出 56%（只在团队月销满 100 万时出现）。
待定：其他加购项目与价格、一级升特级条件、是否先找律师看合规。
