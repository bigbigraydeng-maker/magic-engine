---
id: 2026-10-25-ads-number-consistency
title: 广告点击率、币种和花费周期在各页用同一套算法，不再各说各的
status: decided
owner: agent
decided_on: 2026-10-25
source: issue:3107
verify_by: 2026-11-01
verify_how: 在仓库根目录跑 npx vitest run src/lib/ads/__tests__/spend-figures.test.ts src/lib/meta/__tests__/campaign-aggregate-ctr.test.ts src/lib/marketing-plan/promo/__tests__/reconcile.test.ts，退出码为 0。上线后看同一客户的数据页、趋势卡和推广计划：点击率都由点击除以展示算出，花费带币种和周期，周对账读不到逐日花费时只引用账户合计并标明不是这一周。
---
广告账户合计和各活动的点击率都用点击除以展示，不再混用另一种更小的点击率。
币种先读广告账户快照，没有再读客户所在国家，页面上不出现没标明币种的钱。
花费数字带来源周期。周对账读不到逐日花费时，引用数据页的账户合计并写明那不是这一周，不把它当成这一周的实际花费。
广告账户内部编号不出现在给人看的名称里。广告健康页的 7 天花费不在这张里，因为另一张进行中的改动占着那一页。
