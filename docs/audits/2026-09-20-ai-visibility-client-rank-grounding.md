# AI 可见度「客户排名」误判：历史影响报告（只读）

- 日期：2026-09-20
- 范围：`ai_visibility_runs.client_brand_rank`（每条 AI 回答里客户排第几；null = 没提到客户）
- 方法：用修复后的判定规则（`src/lib/ai-tracker/client-brand-match.ts`）把库里全部 6,596 条历史回答**离线重算一遍**。
  只读数据库，不调 AI，**没有改任何生产数据**。
- 局限：重算用的是当时 AI 解析器已经存下来的品牌列表（`brands_mentioned`），这份列表是在旧的「把客户名塞进提示词」方式下生成的。
  所以「漏记」那一栏里新算出来的名次，是按客户在原文里出现的位置估的，不是重新调 AI 解析的结果。

## 一句话结论

**有 171 条回答被错记成「提到了客户」，另有 340 条客户其实被提到了却没记上。受影响最大的是 Roman HU（记上名次的有 47% 是假的）和 New Asian Logistics（68% 是假的）。**
误记是两个原因造成的：①提示词把客户名直接告诉了 AI，AI 就把客户硬塞进品牌列表；②名字比对太松，Roman 的品牌名写的是「Roman Hu — Ray White Mission Bay」，结果回答里一出现「Ray White」就被当成 Roman 本人。

## 每个客户受影响多少

| 客户 | 回答总数 | 有解析结果的 | 旧：记了名次 | 新：记了名次 | **误记（没提却记了）** | **漏记（提了没记）** | 名次变了 |
|---|---:|---:|---:|---:|---:|---:|---:|
| CTS Tours NZ | 3,827 | 3,096 | 1,519 | 1,768 | 39 (2.6%) | 288 | 20 |
| Roman HU | 562 | 466 | 168 | 118 | **79 (47.0%)** | 29 | 39 |
| Magic Lab Class | 260 | 220 | 23 | 0 | 23 ⚠️ 见下 | 0 | 0 |
| New Asian Logistics | 559 | 511 | 25 | 8 | **17 (68.0%)** | 0 | 0 |
| Magic Lab | 312 | 276 | 7 | 18 | 1 | 12 | 2 |
| Shop Five | 72 | 60 | 0 | 10 | 0 | 10 | 0 |
| CYHB Fashion | 168 | 144 | 12 | 6 | 6 ⚠️ 见下 | 0 | 6 |
| Dixon Homes | 144 | 132 | 65 | 62 | 3 (4.6%) | 0 | 0 |
| IB Real Estate | 144 | 132 | 25 | 22 | 3 | 0 | 0 |
| Sandcastles Hotel | 144 | 132 | 25 | 26 | 0 | 1 | 0 |
| oztop | 260 | 210 | 16 | 16 | 0 | 0 | 0 |
| Kingston International English | 144 | 132 | 30 | 30 | 0 | 0 | 2 |
| **合计** | **6,596** | **5,511** | **1,915** | **2,084** | **171** | **340** | **69** |

「误记」列里 NAL / Roman / Dixon / CTS 四个客户与 PM 9-20 手工 SQL 核对结果**逐个对上**（17/25、79/168、3/65、CTS 多出 1 条是短别名收紧后新发现的无依据记录）。
Magic Lab Class 和 CYHB 的「误记」主要是配置缺口，不是真误记，见下。

抽查例子（都人工看过原文）：
- `36674281`（NAL 记第 4）：回答只讲 DHL/UPS/FedEx，AI 给的「证据」原文是 `Client brand to look for Newasian Logistics`——就是把提示词里的客户名抄回来了。
- `6881dbee`（Roman 记第 1）：回答只列了几个 Ray White 经纪人，Roman 一次没出现。
- `680862a7`（CTS 漏记）：回答里三次引用 ctstours.co.nz 链接，旧规则不认域名。
- `56d9067f`（Roman 漏记）：表格里写着 “Roman Hu (Ray White Mission Bay)”，旧规则因为标点不同（括号 vs 长破折号）没认出来。
- IB Real Estate 3 条、Roman 的 79 条误记：原文里完全没有客户名，都是 AI 塞进去的。

### ⚠️ 需要补配置的客户（不改代码）

- **CYHB Fashion**：配置的品牌名是 `CYHBNZ`，但 AI 回答里写的是 `CYHB`。新规则更严，不再把 `CYHB` 当成 `CYHBNZ`，所以这 6 条会从「提到」变成「没提到」——**这是配置缺口，不是真没提到**。
  修法：在该客户「设置 → 品牌别名」里加上 `CYHB`（已有界面，`BrandAliasesPanel`）。加完以后这 6 条会重新被认出来。
- **Magic Lab Class**：配置的品牌名是 `Magic Lab Class`，AI 回答里（多为中文问答）写的是 `Magic Lab`。新规则不再把「名字的前几个词」自动当成客户——
  因为这条规则会让「Ray White」这种全国品牌冒领「Ray White 某某门店」客户（复审发现）。系统里另有一个客户就叫 `Magic Lab`，自动归属不安全。
  修法：如果这些回答说的确实是 Magic Lab Class，就在它的品牌别名里加 `Magic Lab`；加完这 23 条会重新被认出来。
- **Sandcastles Hotel**：域名 `sandcastles.com.au` 的主干词 “sandcastles” 很泛，有 1 条回答说的是 Airbnb 上的 “Sandcastles resort”，新规则把它算成提到了。量很小，先记录。

## 谁在读这个数字（修了以后，哪些页面/分数会变）

**每次打开都现算的（历史数据一改，这些自动变对）：**
- 内部 AI 可见度看板：`src/app/dashboard/ai-visibility/[clientId]/`（提及率、平均名次、每题 #名次）、首页各引擎平均名次 `src/app/dashboard/page.tsx`
- 月报：`src/lib/reports/monthly-aggregator.ts`、`src/lib/monthly-report/collectors/ai-tracker.ts` → **会给客户看**
- 博客选题 / 页面 SEO 升级找「AI 没提到我们的问题」：`src/lib/blog/topic-selector.ts`、`src/lib/blog/page-seo-intelligence.ts`

**算完存成表的（只修历史回答还不够，这些存下来的旧数不会自己变）：**

| 存在哪 | 谁用它 | 给客户看？ |
|---|---|---|
| `ai_visibility_snapshots`（每客户每周一行：提及次数、平均名次） | 月报、诊断打分、GEO 指令、竞品简报 | 间接给 |
| `flywheel_metrics`（`geo.query.mention_rate` / `avg_rank`，只增不改） | 健康分、异常告警、效果归因、案例库基准、执行视图 | 内部 |
| `diagnostic_runs` / `diagnostic_findings` / `diagnostic_narratives`（AI 可见度支柱 0-100 分 = 70% 提及率 + 30% 名次） | **客户门户**的诊断页和「月度报告」页 | **是** |
| `content_strategy_items`、`geo_directives`、已发布的博客 | 用「AI 没提到我们的问题」生成的内容 | 已发出去的撤不回 |

## 建议的后续（都要 PM 点头才能动，本次一条没做）

1. **修正历史回答的名次**：按本报告的重算结果，改写 `ai_visibility_runs.client_brand_rank`（误记 171 条改成空、漏记 340 条补上、变动 69 条改名次；先补完下面第 5 条的别名再算）。只动这一列，不删行。
2. **重算每周快照**：重算受影响客户、受影响周的 `ai_visibility_snapshots`。
3. **诊断分**：不改旧的诊断记录，让受影响客户（Roman、NAL 优先）下一次诊断自动用新数。
4. **`flywheel_metrics`** 只增不改：建议不改旧行，只在趋势图上标一下「2026-09-20 口径修正」。
5. **补品牌别名**：CYHB 加 `CYHB`；Magic Lab Class 视情况加 `Magic Lab`。在设置界面里加即可，建议在第 1 步之前做完。

## 规则口径说明（与 GEO 解读模块的差异，有意为之）

`src/lib/geo-module/m1.ts` 的口径是「回答里引了客户网址 ≠ 提到客户」；本模块把**客户自己的网址被引用**算作「提到」，
因为排名问题问的是「AI 推荐列表里有没有你」，被当作来源引用就是出现在推荐里（例：`680862a7` 三次引用 ctstours.co.nz）。
如果客户配置的 domain 带路径（例如挂在加盟总部网站下的个人页），就不把这个网址当作客户身份，避免总部品牌冒领。

**短别名（含 3–5 字的中文别名）不能单独作证**：只有「别名」受这条限制，客户的**正式品牌名**再短也照样算（例如 `oztop`、中文正式名）。
原因是实测数据：CTS 的别名 `中国旅行社` 同时也是通用词组，`1cd2cb2e` / `f73f6c86` 两条回答里它只是「知名的中国旅行社」这种泛指，旧口径据此记了第 1 名。
中文没有词边界，机器分不出「泛指」还是「专名」，所以短别名一律要靠解析器把它当成一个品牌抽出来才算数。
如果某个中文名必须能单独作证，就把它配成客户的正式品牌名（`master_briefs.brand_name`），而不是别名。

## 复现

重算脚本逻辑：分页读 `ai_visibility_runs(id, client_id, raw_response, brands_mentioned, client_brand_rank)`，
身份信息取 `master_briefs.brand_name`（status=active，没有就用 `clients.name`）+ `clients.domain` + `clients.brand_aliases`，
逐行跑 `resolveClientBrandRank(brands_mentioned, raw_response, identity)`，再和已存的 `client_brand_rank` 比较。
注意：跑的时候用的是**当前**的品牌名和别名配置，不是每条回答生成当时的配置。
