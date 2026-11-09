# CTS「商业页保护名单」写入记录（2026-10-04）

**谁批的**：PM 在对话里回「保护」（2026-10-04），清单是我提议、PM 未改动。
**写了什么**：正式库 `clients.seo_config` 里给 CTS 加了一个字段 `meta_cycle_protected_slugs`，其余字段用 jsonb 合并（`||`）原样保留。

写入前：没有这个字段（读出为 null）。
写入后：

```json
["china-tours","china-tours-from-new-zealand","tours","about","china-travel-specialists-nz","china-visa-guide-for-new-zealanders","china-visa-free-nz-2026"]
```

其余字段回读核对：`meta_cycle_enabled=true`、`meta_cycle_max_pages=3`、`meta_cycle_keyword_fallback_locations=[2036]`、`weekly_blog=true`、`meta_cycle_brand_voice` 仍含「Do NOT add any brand suffix」（未改动）。

**为什么**：2026-09-23 空跑发现 `/china-tours`（询盘主入口）会被改成丢掉出发城市和价格的版本；闸门代码早已支持保护名单，但 CTS 这边一直是空的，主列表页只靠别的闸挡着。9 月 19 日出事的是签证页，所以两个签证页也列入。

**生效证据（线上真实代码空跑，只读、不写库、不开 PR，2026-10-04）**：`china-tours` 与 `about` 被判 `protected_conversion_page`，在任何花钱步骤之前就被跳过。

## 回滚（一句话撤掉保护）

```sql
UPDATE clients SET seo_config = seo_config - 'meta_cycle_protected_slugs' WHERE name = 'CTS Tours NZ';
```
