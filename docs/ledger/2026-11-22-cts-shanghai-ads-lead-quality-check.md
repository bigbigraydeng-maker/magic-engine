---
id: 2026-11-22-cts-shanghai-ads-lead-quality-check
title: CTS 上海团两组 Meta 广告（A 组、扩量组）带来的客人，12-07 再查报价和成交；扩量组的客人那时才满 14 天，现在判不了
status: decided
owner: agent
decided_on: 2026-11-22
source: session:ec90bb17
verify_by: 2026-12-07
verify_how: 只读查 CTS 客人表、阶段历史和订单表。看两组各有多少客人走到「已报价」及以后，有没有填表之后下的新订单，还剩多少「新客人」没有电话记录。扩量组满 14 天的客人报价率 ≥10%（11-03 基线）算成；低于基线就报 PM，决定这套素材和受众还要不要再用
---
2026-11-22 只读核对（Meta 账户 7274 + ME 生产库 glbdnayojixmexgofbsd，客户 CTS）。

**Meta 数据**
- A 组 `120250459565950307`：累计花费 NZ$1,780，259 条表单。
- 扩量组 `120250648033550307`：累计花费 NZ$1,377，149 条表单。11-19 17:08 到期自动停。
- 11-20 起账户每天花费都是 0。
- 11-10 到 11-19 账户合计：花费 NZ$1,557，160 条表单，平均每条 NZ$9.7。

**ME 里对得上这两组的客人**

| | 客人数 | 走到「已报价」及以后 | 满 14 天的客人 | 满 14 天里报过价的 |
|---|---|---|---|---|
| A 组 | 227 | 15 | 145 | 11（7.6%） |
| 扩量组 | 149 | 5 | 33 | 0 |

- 两组都没有填表之后下的新订单。
- 376 位里，248 位还停在 `new`，其中 151 位没有任何外呼电话记录。另外 97 位打过电话，但状态没改。
- 基线：11-03 的数字是近 30 天 154 位里合格 15 位，约 10%。
- CTS 从填表到付定金，中位数是 41 天，所以现在看不出成交。

**复查 SQL**（只读，把 `<A>`、`<扩量>` 换成上面两个组号）：
```sql
with c as (select id, attr_adset_id, stage, coalesce(first_attributed_at, created_at) t0 from contacts
  where client_id='c0000000-0000-0000-0000-000000000000' and attr_adset_id in ('<A>','<扩量>')),
q as (select distinct contact_id from contact_stage_events where client_id='c0000000-0000-0000-0000-000000000000'
  and to_stage in ('quoted','deposit_paid','paid_full','traveling_soon','trip_completed'))
select attr_adset_id, count(*) n,
  count(*) filter (where stage in ('quoted','deposit_paid','paid_full','traveling_soon','trip_completed') or q.contact_id is not null) qualified,
  count(*) filter (where t0 < now() - interval '14 days') matured
from c left join q on q.contact_id = c.id group by 1;
```
订单：`crm_bookings`。只算 `booked_on` 不早于该客人进来那天的单，取消的不算。
