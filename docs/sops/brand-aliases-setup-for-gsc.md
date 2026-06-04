# Brand Aliases 配置 SOP — Goal brand_search_volume 主指标

> **适用范围**：客户的 Goal 选了 `brand_search_volume` 作为主指标，要让 ME 从 GSC 自动算出"真实品牌词点击数"。
> **目标**：让 Goal 详情页主指标卡显示真实数字，而不是 0 或 fallback 到 DataForSEO 估算。
> **耗时**：每个客户 5-10 分钟（一次性配置）。
> **维护人**：FDE

---

## 0 · 这是干嘛的

A2.2 上线后，`brand_search_volume` 这个 Goal 主指标的取数逻辑是：

```
1. 看 clients.brand_aliases（你填的别名列表）
2. 用别名 + 域名根 (e.g. ctstours) 在 GSC top_queries 里做 substring 匹配
3. 把所有命中 query 的 clicks 求和
4. 如果一个都没命中 → 降级到 DataForSEO 估算
```

**为什么要 FDE 配 brand_aliases**：单词品牌（"oztop"）域名根自己就能匹配，但多词品牌（"CTS Tours"）域名根是 "ctstours"，而真实 GSC 查询是 "cts tours"（带空格）—— 用户搜索时**会带空格**，所以光靠域名根会漏掉绝大部分品牌搜索。

**真实数据示例（2026-06-04 audit, CTS Tours NZ）**：

| GSC top query | clicks | 仅靠域名根 "ctstours" | 加 alias `"cts tours"` |
|---|---|---|---|
| `cts tours` | 127 | ❌ 漏 | ✅ |
| `china travel service nz` | 21 | ❌ 漏 | ✅（alias `"china travel service"`）|
| `cts travel` | 13 | ❌ 漏 | ✅（alias `"cts travel"`）|
| `ctstoursnz` | 5 | ✅ | ✅ |
| **合计** | **166** | **5** | **166** |

配 alias 前 CTS 这个 Goal 卡显示 5，配 alias 后显示 166 — 这才是真实品牌搜索量。

---

## 1 · 收集客户的品牌词（5 分钟）

打开 GSC → 选客户的 property → **左侧 Performance → Queries**，按 **Clicks 倒序**排，看前 20-50 条 query：

- 哪些是用户主动搜你品牌的？（带客户公司名、缩写、产品线名）
- 把它们**最短的稳定形式**整理成一个列表

**经验规则**：
- 多写几个变体没坏处（substring 匹配，写 `"cts tours"` 自动覆盖 `"cts tours review"` / `"cts tours auckland"` 全部 query）
- 至少 2 字符（1 字符的别名会被代码忽略，防止误命中）
- 大小写不区分（写 `"CTS Tours"` 和 `"cts tours"` 效果一样）
- 不要写太通用的词（"travel" 不行，"china travel service" 可以）

**CTS Tours NZ 推荐配置**：
```json
["cts tours", "cts travel", "china travel service", "ctsnz"]
```

**Oztop 推荐配置**：
```json
["oztop building supplies", "oz top"]
```
（"oztop" 已经在域名根里，不用重复写；但 "oz top" 是用户拼写空格的版本，要单独加）

---

## 2 · 写入 Supabase（2 分钟）

> 目前没有 UI（Phase 后续会加 Settings 页字段），先用 Supabase Studio 直填。

1. 打开 [Supabase Studio](https://supabase.com/dashboard) → 选 `magic-engine` (CrazyContent) 项目
2. 左侧 **Table Editor → clients**
3. 找到客户行（按 `name` 列搜）
4. 双击 `brand_aliases` 单元格
5. 填入 JSON 数组（必须是 PostgreSQL `text[]` 字面量格式，注意是花括号 `{}` 不是方括号 `[]`）：

```
{"cts tours","cts travel","china travel service","ctsnz"}
```

保存（按 Enter 或 Save）。

> 如果你用的是 Supabase MCP（Claude Code 帮你做）：
> ```sql
> UPDATE public.clients
>    SET brand_aliases = ARRAY['cts tours','cts travel','china travel service','ctsnz']
>  WHERE name = 'CTS Tours NZ';
> ```

---

## 3 · 验证（3 分钟）

1. 打开该客户的 Goal 详情页，找一个 `primary_metric_key = brand_search_volume` 的 Goal
2. **当前值卡片**应该显示：
   - 一个非零数字（CTS ~170 / Oztop ~46）
   - 数据源标签 = `GSC clicks (28-day brand searches)`
   - 副标签 = `N brand-search clicks (M queries · 时间区间)`
3. 如果显示 fallback 文案 `DataForSEO bulk keyword volume (estimate · GSC not yet connected)` → 你的 alias 没匹配上，回 §1 检查（多半是别名写得太严格，比如 `"CTS Tours NZ"` 整串而 GSC query 是 `"cts tours"`）

---

## 4 · 没有 Goal 用 brand_search_volume 怎么办

如果客户当前 Goal 都不用 `brand_search_volume` 主指标，A2.2 代码不会被触发（这是当前 CTS / Oztop 的情况，2026-06-04 audit）。要先建一个：

1. 客户 dashboard → **新建 Goal**
2. 选 Goal 类型：**品牌曝光 (awareness)**
3. 主指标选：**品牌词搜索量 (brand_search_volume)**
4. 目标值填一个对照 baseline 的目标（例如 CTS 当前 ~170/月 → 目标 250/月）
5. 保存后，详情页就会触发 A2.2 取数

---

## 5 · 后续 backlog

- [ ] Settings 页加 `brand_aliases` 可视化编辑字段（避免每次 FDE 操作都要进 Supabase Studio）
- [ ] cron 自动建议 — 跑 GSC top queries 给出"未识别但点击数很高"的 query 候选，提醒 FDE 是否补 alias
- [ ] 多语言 / 多市场处理（CTS 在中国市场可能搜索"长城旅游服务"，目前 alias 没覆盖中文）
