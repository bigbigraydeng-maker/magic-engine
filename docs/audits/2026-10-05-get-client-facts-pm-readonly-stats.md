# getClientFacts 第 1 步：切换前要从生产库跑的 5 条只读统计

日期 2026-10-05 · 对应 `docs/audits/2026-10-05-get-client-facts-step1-design.md`。全部是只读 `select`，不写库。
语法已在本机一次性沙盘（合成数据，非生产）里跑通；**还没在生产库跑过**。

| # | 问什么 | 看到什么算有问题 |
|---|---|---|
| 1 | 生产库这 11 个字段都在不在 | 少于 11 行。少 `excluded_topics` 最可能（迁移头写「未经 PM 批准不得 apply」）→ 新函数会对所有客户返回 `schema_not_ready`，要先批准那条迁移 |
| 2 | 「状态」和「是否生效」两列对不上的客户 | 有行就是对不上：`n_draft_but_is_active>0` 说明有草稿被旧代码当成生效版 |
| 3 | 新函数取不到生效版本的客户 | 有行 = 这些客户新函数会返回 `no_active_brief`（旧代码可能还能取到草稿） |
| 4 | 每个客户三类禁忌词各配了几条 | 三个数都是 0 = 该客户没有任何红线，新函数会标 `none_configured` |
| 5 | 旧代码当硬红线、新结构里降成「只提示」的词有几条 | `avoid_words_not_in_redlines>0` = 切换前必须逐个核对，否则那些词的拦截会变松 |

```sql
-- 1) 字段在不在（期望 11 行）
select table_name, column_name from information_schema.columns
where table_schema='public' and (
  (table_name='master_briefs' and column_name in ('excluded_topics','avoid_words','project_id','status','is_active','website','source_website_urls','brand_voice','vi_colors'))
  or (table_name='clients' and column_name in ('brand_redline_phrases','domain')))
order by 1,2;

-- 2) 状态与是否生效两列对不上的客户（只看客户级 brief）
select client_id,
  count(*) filter (where status='active') as n_status_active,
  count(*) filter (where is_active) as n_is_active,
  count(*) filter (where is_active and status='draft') as n_draft_but_is_active,
  count(*) filter (where is_active and status is null) as n_legacy_null_status,
  count(*) filter (where status='active' and not coalesce(is_active,false)) as n_active_but_is_active_false
from master_briefs where project_id is null group by client_id
having count(*) filter (where status='active') <> 1
    or count(*) filter (where is_active and status is distinct from 'active') > 0
    or count(*) filter (where status='active' and not coalesce(is_active,false)) > 0;

-- 3) 没有「状态=生效」的客户级 brief 的客户
select c.id, c.domain from clients c
where not exists (select 1 from master_briefs b where b.client_id=c.id and b.project_id is null and b.status='active');

-- 4) 三类禁忌词各配了几条
select c.id,
  coalesce(array_length(c.brand_redline_phrases,1),0) as n_redline,
  coalesce(array_length(b.excluded_topics,1),0) as n_topics,
  coalesce(array_length(b.avoid_words,1),0) as n_avoid_words
from clients c join master_briefs b on b.client_id=c.id and b.project_id is null and b.status='active'
order by c.id;

-- 5) avoid_words 里有、但红线名单里没有的词（旧广告路径当硬红线）
select c.id, count(*) as avoid_words_not_in_redlines
from clients c join master_briefs b on b.client_id=c.id and b.project_id is null and b.status='active',
     unnest(b.avoid_words) as w
where not exists (select 1 from unnest(c.brand_redline_phrases) r where lower(r)=lower(w))
group by c.id;
```

不在本 PR：规划里的「近 90 天已发/待发内容命中数」需要函数接进渠道后才算得出来，留给影子对比那一步。
