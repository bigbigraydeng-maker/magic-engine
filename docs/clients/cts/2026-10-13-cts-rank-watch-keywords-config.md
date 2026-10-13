# CTS 指定追踪词：配置、回执与回滚

> 风险级：B。功能代码见 `src/lib/seo-intelligence/watch-keywords.ts`；本文只管「往 CTS 配置里加两个词」这一步。

## 要写什么
表 `clients`，CTS 那一行的 `seo_config`（jsonb，已存在）里**追加一个键** `rank_watch_keywords = ["guilin", "silk road"]`。不碰该配置里的其他键，不改表结构。

写入前的 `seo_config` 键清单（2026-10-13 只读核对）：brand_terms、weekly_blog、meta_cycle_enabled、meta_cycle_max_pages、brand_ambiguous_terms、meta_cycle_brand_voice、meta_cycle_protected_slugs、meta_cycle_keyword_fallback_locations。**没有** `rank_watch_keywords`。

## 执行语句（等点头后由有权限的人跑一次）
```sql
update clients
set seo_config = jsonb_set(coalesce(seo_config, '{}'::jsonb), '{rank_watch_keywords}', '["guilin","silk road"]'::jsonb, true)
where domain = 'ctstours.co.nz' and client_status = 'active'
returning id, seo_config -> 'rank_watch_keywords' as rank_watch_keywords;
```
预期：恰好返回 1 行，值为 `["guilin","silk road"]`。

## 回滚（撤回这两个词，其他配置不动）
```sql
update clients set seo_config = seo_config - 'rank_watch_keywords'
where domain = 'ctstours.co.nz' and client_status = 'active'
returning id, seo_config ? 'rank_watch_keywords' as still_has_key;
```
预期：返回 1 行，`still_has_key = false`。回滚后功能代码自动闲置（没有追踪词就不查），已写入的快照行是历史记录，不删。

## 成本
实测每个词一次实时查询 US$0.0155（深度 100，2026-10-13 当场试跑的供应商回报值）。2 个词每周 US$0.031，按月约 US$0.13，占每月 US$15 付费数据预算不到 1%。
