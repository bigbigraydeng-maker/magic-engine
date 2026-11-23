# CTS 团页线上体检（逐页缺口表）— 2026-10-13

> 取数：对 `https://www.ctstours.co.nz` 的 `/tours/china/*` 与 `/campaigns/*` 逐个做一次公开网页 GET（5 并发、无登录、无付费接口、零花费），读线上真实的标题、描述、规范网址、结构化数据（JSON-LD）、页面正文。方法同 `2026-10-05-serp-snippet-audit.md`。
> 范围：sitemap 里的 **31 个有正文的团页 / 活动页**，另探 4 个网址（Natural China 旧 Discovery 页、旧的 `beijing-shanghai`、`/campaigns/october-2026/beijing-xian`、`/tours` 枢纽页）。
> **与「33 页」的差**：策略文档引用的抓取表是 33 页，线上 sitemap 只有 31 页；多出的 2 页没有逐一对齐（可能是已跳转的旧网址）。这份表以线上 31 页为准。
> 风险级：**C**（只读 + 写 `docs/`）。数据来自线上，不是抓取表。

## 一、先说结论

**第一周要回答的问题——「22 页没有逐日行程，是真缺还是没抓到」：在线上 31 页范围内，不是真缺，是抓取表认字的方式漏了。原抓取表比线上多 2 页还没对齐，这两页是否缺行程尚未检查，原问题对这两页仍未解决。**
- 31 页里 **29 页线上有真正的逐日行程**（正文里有，结构化数据里也有 2～27 条）。
- 只有 2 页没有：`/campaigns/chongqing`（重庆广告落地页）和 `/campaigns/spotlight`（主推汇总页）——它们本来就不是单个产品页，不算缺。
- 抓取表里「Day N」字样只在 9 页出现，是因为另外 20 页（4 个 Signature 团页、3 个活动落地页、13 个 Stopover 页）把天数写成纯数字或折叠起来，没有「Day」这个词。**内容是在的。**
- 其中 Best of China（`/tours/china/discovery/essentials`）的结构化数据里行程只有 **5 个城市停靠**，不是 15 天逐日。代码注释写明是早先一份规格有意这么做的，不是缺陷。

**真正的缺口排序（见第三节）：**
1. **全站每个团页都带「100+ Years Heritage / Founded 1928 / 25 years」字样**——违反 PM 2026-10-08 的规矩（两个都不写）。来源是共用的页头页脚组件，不是单页文案。
2. **29 个团页的结构化数据都把公司的谷歌评分（4.4 分 / 12 条）盖在每个产品上**——谷歌不允许公司给自己的产品打星，有被取消星级展示的风险。
3. **5 个团页在数据里写着编造的评分和评价数**（4.6～4.9 分、94～312 条），与真实的 4.4 / 12 对不上。
4. **同一个产品有多个都能被收录的网址**：Best of China、Tale of Two Cities、Shanghai & Surroundings 各有 2 个。是否在争同样的搜索词还没核对（上海几页的排名更像覆盖不同词，见 2026-10-12 点击机会文档），需先用谷歌搜索词重叠确认，再决定合并或指定主网址。
5. **每页都没有 Tripadvisor 字样**（0/31）。
6. 官网班期与 CTS 内部 2027 出团表有差异：只有 Shanghai 的 5/25、11/5 经 PM 确认可售，是确认的缺口；其余差异是内部计划，待 CTS 确认是否对外开卖。

## 二、逐页表

### 表 A：搜索结果里显示什么（标题 / 描述 / 规范网址 / 结构化数据）

标题字数是线上 `<title>` 的字符数；描述超过 160 字符的页数：25（本表不逐页列，策略文档判定描述长度不是杠杆）。「评分标记」= 结构化数据里有没有 `aggregateRating`（✓ = 有，是上面第 2 条风险）。

| 网址 | 类型 | 线上标题（字数） | 描述字数 | 规范网址 | 结构化数据类型 | 评分标记 |
|---|---|---|---|---|---|---|
| `/campaigns/best-of-china` | 活动页 | China Discovery — Best of China \| 15 Days \| CTS Tours (53) | 189 | 自指 | BreadcrumbList/FAQPage/Product/TouristTrip | ✓ |
| `/campaigns/chongqing` | 活动页 | Chongqing Tours from New Zealand \| Packages & Custom Itineraries \| CTS Tours (76) | 194 | 自指 | TravelAgency | ✗ |
| `/campaigns/spotlight` | 活动页 | Spotlight China Tours from New Zealand \| CTS Tours (50) | 147 | 自指 | FAQPage/ItemList | ✗ |
| `/campaigns/october-2026/shanghai-surroundings` | 活动页 | Shanghai & Surroundings — 2027 departure \| CTS NZ (49) | 202 | 自指 | BreadcrumbList/FAQPage/Product/TouristTrip | ✓ |
| `/campaigns/october-2026/tale-of-two-cities` | 活动页 | Beijing & Xi’an — 2027 departure \| CTS NZ (41) | 229 | 自指 | BreadcrumbList/FAQPage/Product/TouristTrip | ✓ |
| `/campaigns/fire-fuzz` | 活动页 | Fire & Fuzz — Chongqing & Chengdu \| 10 Days from NZ \| CTS Tours (63) | 210 | 自指 | BreadcrumbList/FAQPage/Product/TouristTrip | ✓ |
| `/tours/china/signature/silk-road` | 团页 | China Signature — Silk Road \| 18 Days \| CTS Tours (49) | 154 | 自指 | BreadcrumbList/FAQPage/Product/TouristTrip | ✓ |
| `/tours/china/signature/imperial-heritage` | 团页 | China Signature — Legacy of China \| 17 Days \| CTS Tours (55) | 142 | 自指 | BreadcrumbList/FAQPage/Product/TouristTrip | ✓ |
| `/tours/china/signature/grand-tour` | 团页 | China Signature — China Panorama \| 27 Days \| CTS Tours (54) | 185 | 自指 | BreadcrumbList/FAQPage/Product/TouristTrip | ✓ |
| `/tours/china/signature/landscapes` | 团页 | China Signature — Natural China \| 16 Days \| CTS Tours (53) | 192 | 自指 | BreadcrumbList/FAQPage/Product/TouristTrip | ✓ |
| `/tours/china/discovery/beijing-xian` | 团页 | Beijing & Xi'an Discovery Tour \| March 2027 \| CTS NZ (52) | 304 | 自指 | BreadcrumbList/FAQPage/Product/TouristTrip | ✓ |
| `/tours/china/discovery/essentials` | 团页 | China Discovery — Best of China \| 15 Days \| CTS Tours (53) | 189 | 自指 | BreadcrumbList/FAQPage/Product/TouristTrip | ✓ |
| `/tours/china/discovery/shanghai-surroundings` | 团页 | Shanghai & Surroundings Discovery \| March 2027 \| CTS NZ (55) | 259 | 自指 | BreadcrumbList/FAQPage/Product/TouristTrip | ✓ |
| `/tours/china/discovery/yunnan-explorer` | 团页 | China Discovery — Colorful Yunnan \| 11 Days \| CTS Tours (55) | 144 | 自指 | BreadcrumbList/FAQPage/Product/TouristTrip | ✓ |
| `/tours/china/discovery/china-icons-collection` | 团页 | Christmas & New Year in China 16 Days \| CTS Tours (49) | 165 | 自指 | BreadcrumbList/FAQPage/Product/TouristTrip | ✓ |
| `/tours/china/discovery/china-icons-collection-christchurch` | 团页 | Christmas & New Year in China — Christchurch Departure \| CTS Tours (66) | 182 | 自指 | BreadcrumbList/FAQPage/Product/TouristTrip | ✓ |
| `/tours/china/stopover/beijing` | 团页 | China Stopover — Beijing (5 Days) \| 5 Days \| CTS Tours (54) | 164 | 自指 | BreadcrumbList/FAQPage/Product/TouristTrip | ✓ |
| `/tours/china/stopover/beijing-express` | 团页 | China Stopover — Beijing Express (3 Days) \| 3 Days \| CTS Tours (62) | 164 | 自指 | BreadcrumbList/FAQPage/Product/TouristTrip | ✓ |
| `/tours/china/stopover/shanghai` | 团页 | China Stopover — Shanghai (3 Days) \| 3 Days \| CTS Tours (55) | 164 | 自指 | BreadcrumbList/FAQPage/Product/TouristTrip | ✓ |
| `/tours/china/stopover/shanghai-express` | 团页 | China Stopover — Shanghai Express (2 Days) \| 2 Days \| CTS Tours (63) | 158 | 自指 | BreadcrumbList/FAQPage/Product/TouristTrip | ✓ |
| `/tours/china/stopover/chengdu` | 团页 | China Stopover — Chengdu (3 Days) \| 3 Days \| CTS Tours (54) | 164 | 自指 | BreadcrumbList/FAQPage/Product/TouristTrip | ✓ |
| `/tours/china/stopover/guilin` | 团页 | China Stopover — Guilin (3 Days) \| 3 Days \| CTS Tours (53) | 156 | 自指 | BreadcrumbList/FAQPage/Product/TouristTrip | ✓ |
| `/tours/china/stopover/xian` | 团页 | China Stopover — Xi'an (3 Days) \| 3 Days \| CTS Tours (52) | 164 | 自指 | BreadcrumbList/FAQPage/Product/TouristTrip | ✓ |
| `/tours/china/stopover/guangzhou` | 团页 | China Stopover — Guangzhou (3 Days) \| 3 Days \| CTS Tours (56) | 164 | 自指 | BreadcrumbList/FAQPage/Product/TouristTrip | ✓ |
| `/tours/china/stopover/shanghai-suzhou` | 团页 | China Stopover — Shanghai & Suzhou (3 Days) \| 3 Days \| CTS Tours (64) | 164 | 自指 | BreadcrumbList/FAQPage/Product/TouristTrip | ✓ |
| `/tours/china/stopover/shanghai-wuzhen` | 团页 | China Stopover — Shanghai & Wuzhen (4 Days) \| 4 Days \| CTS Tours (64) | 164 | 自指 | BreadcrumbList/FAQPage/Product/TouristTrip | ✓ |
| `/tours/china/stopover/guilin-surrounds` | 团页 | China Stopover — Guilin & Surrounds (4 Days) \| 4 Days \| CTS Tours (65) | 164 | 自指 | BreadcrumbList/FAQPage/Product/TouristTrip | ✓ |
| `/tours/china/stopover/zhangjiajie` | 团页 | China Stopover — Zhangjiajie (3 Days) \| 3 Days \| CTS Tours (58) | 164 | 自指 | BreadcrumbList/FAQPage/Product/TouristTrip | ✓ |
| `/tours/china/stopover/guangzhou-shenzhen` | 团页 | China Stopover — Guangzhou & Shenzhen (4 Days) \| 4 Days \| CTS Tours (67) | 164 | 自指 | BreadcrumbList/FAQPage/Product/TouristTrip | ✓ |
| `/tours/china/stopover/huangshan` | 团页 | China Stopover — Huangshan (4 Days) \| 4 Days \| CTS Tours (56) | 164 | 自指 | BreadcrumbList/FAQPage/Product/TouristTrip | ✓ |
| `/tours/china/discovery/golden-china` | 团页 | China Discovery — Golden China \| 12 Days \| CTS Tours (52) | 181 | 自指 | BreadcrumbList/FAQPage/Product/TouristTrip | ✓ |

读法：
- **标题 > 60 字符：9 页**（`/campaigns/chongqing`、`/campaigns/fire-fuzz`、`china-icons-collection-christchurch`、6 个 Stopover 页）。**没有标题带重复品牌后缀**（`| CTS | CTS Tours`）。标题怎么改走既有的标题周循环（六条闸门），本表不授权改动。
- 规范网址：31 页全部**指向自己**。这对「同产品多网址」可能是问题，需先核对搜索词重叠（见第三节 4）。
- 结构化数据：29 页有 `TouristTrip` + `Product` + `BreadcrumbList` + `FAQPage`；`/campaigns/chongqing` 只有 `TravelAgency`；`/campaigns/spotlight` 只有 `ItemList` + `FAQPage`。

### 表 B：页面内容齐不齐

「行程」= 结构化数据里的逐日条数（Essentials 是 5 个城市停靠）；「班期」= tours.ts 里的出发日个数；「具名酒店」= tours.ts 里不重复的酒店名个数（含「或同级」；巡游船算一家）；「问答」= 结构化数据里问答条数；「1928 / 25年」= 页面正文里出现 1928 的次数 / 出现「25 years / 100+ years / since 2000」的次数（来源见第三节 1）。

| 网址 | 行程（结构化条数） | 页面有「Day」字样 | 结构化价格 | 价格档数 | 班期 | 具名酒店 | 问答 | Tripadvisor | 1928 / 25年 |
|---|---|---|---|---|---|---|---|---|---|
| `/campaigns/best-of-china` | 15 | 有「Day N」 | NZD 4,080 | 2 | – | – | 2 | 无 | 14 / 11 |
| `/campaigns/chongqing` | 0 | 无「Day」字样 | 无 | 0 | – | – | 0 | 无 | 8 / 6 |
| `/campaigns/spotlight` | 0 | 无「Day」字样 | 无 | 0 | – | – | 5 | 无 | 11 / 9 |
| `/campaigns/october-2026/shanghai-surroundings` | 10 | 无「Day」字样 | NZD 2,699 | 1 | – | – | 8 | 无 | 11 / 8 |
| `/campaigns/october-2026/tale-of-two-cities` | 10 | 无「Day」字样 | NZD 3,480 | 2 | – | – | 8 | 无 | 11 / 8 |
| `/campaigns/fire-fuzz` | 10 | 无「Day」字样 | NZD 2,999 | 1 | – | – | 4 | 无 | 11 / 8 |
| `/tours/china/signature/silk-road` | 18 | 无「Day」字样 | NZD 7,999 | 2 | 2 | 8 | 4 | 无 | 11 / 8 |
| `/tours/china/signature/imperial-heritage` | 17 | 无「Day」字样 | NZD 9,999 | 3 | 3 | 6 | 4 | 无 | 11 / 8 |
| `/tours/china/signature/grand-tour` | 27 | 无「Day」字样 | NZD 10,899 | 2 | 2 | 11 | 4 | 无 | 11 / 8 |
| `/tours/china/signature/landscapes` | 16 | 无「Day」字样 | NZD 7,349 | 1 | 1 | 6 | 4 | 无 | 11 / 8 |
| `/tours/china/discovery/beijing-xian` | 10 | 有「Day N」 | NZD 3,480 | 2 | 2 | 2 | 8 | 无 | 10 / 8 |
| `/tours/china/discovery/essentials` | 5 | 有「Day N」 | NZD 4,080 | 2 | 2 | 5 | 2 | 无 | 10 / 8 |
| `/tours/china/discovery/shanghai-surroundings` | 10 | 有「Day N」 | NZD 2,699 | 1 | 1 | 5 | 8 | 无 | 10 / 8 |
| `/tours/china/discovery/yunnan-explorer` | 11 | 有「Day N」 | NZD 3,899 | 1 | 1 | 4 | 4 | 无 | 10 / 8 |
| `/tours/china/discovery/china-icons-collection` | 16 | 有「Day N」 | NZD 7,188 | 1 | 1 | 5 | 7 | 无 | 10 / 8 |
| `/tours/china/discovery/china-icons-collection-christchurch` | 15 | 有「Day N」 | NZD 6,188 | 1 | 1 | 4 | 7 | 无 | 10 / 8 |
| `/tours/china/stopover/beijing` | 5 | 无「Day」字样 | NZD 2,120 | 1 | 0 | 1 | 4 | 无 | 11 / 8 |
| `/tours/china/stopover/beijing-express` | 3 | 无「Day」字样 | NZD 1,450 | 1 | 0 | 1 | 4 | 无 | 11 / 8 |
| `/tours/china/stopover/shanghai` | 3 | 无「Day」字样 | NZD 1,060 | 1 | 0 | 1 | 4 | 无 | 11 / 8 |
| `/tours/china/stopover/shanghai-express` | 2 | 无「Day」字样 | NZD 875 | 1 | 0 | 1 | 4 | 无 | 11 / 8 |
| `/tours/china/stopover/chengdu` | 3 | 无「Day」字样 | NZD 1,359 | 1 | 0 | 1 | 4 | 无 | 11 / 8 |
| `/tours/china/stopover/guilin` | 3 | 无「Day」字样 | NZD 1,099 | 1 | 0 | 1 | 4 | 无 | 11 / 8 |
| `/tours/china/stopover/xian` | 3 | 无「Day」字样 | NZD 945 | 1 | 0 | 1 | 4 | 无 | 11 / 8 |
| `/tours/china/stopover/guangzhou` | 3 | 无「Day」字样 | NZD 1,399 | 1 | 0 | 1 | 4 | 无 | 11 / 8 |
| `/tours/china/stopover/shanghai-suzhou` | 3 | 无「Day」字样 | NZD 1,356 | 1 | 0 | 1 | 4 | 无 | 11 / 8 |
| `/tours/china/stopover/shanghai-wuzhen` | 4 | 无「Day」字样 | NZD 1,760 | 1 | 0 | 1 | 4 | 无 | 11 / 8 |
| `/tours/china/stopover/guilin-surrounds` | 4 | 无「Day」字样 | NZD 1,310 | 1 | 0 | 1 | 4 | 无 | 11 / 8 |
| `/tours/china/stopover/zhangjiajie` | 3 | 有「Day N」 | NZD 1,899 | 1 | 0 | 1 | 4 | 无 | 10 / 8 |
| `/tours/china/stopover/guangzhou-shenzhen` | 4 | 无「Day」字样 | NZD 2,340 | 1 | 0 | 1 | 4 | 无 | 11 / 8 |
| `/tours/china/stopover/huangshan` | 4 | 无「Day」字样 | NZD 1,635 | 1 | 0 | 2 | 4 | 无 | 11 / 8 |
| `/tours/china/discovery/golden-china` | 12 | 有「Day N」 | NZD 4,999 | 1 | – | – | 4 | 无 | 10 / 8 |

## 三、站点级发现（每条：证据 → 为什么要紧 → 谁来动）

**1. 公司年龄字样（1928 / 25 年 / 100+ 年 / since 2000）遍布每个页面。**
- 证据：31 个页面正文里出现 1928 各 8～14 次、年数字样（25 years / 100+ years / since 2000）各 6～11 次。来源组件：`src/components/TrustBar.tsx:16-17`（「100+ Years Heritage · Founded 1928」）、`src/components/tours/TourTrustSignals.tsx:37`、`src/components/Footer.tsx:17`、`src/components/Hero.tsx:48`，另有**一块看不见的文字**：`src/components/GeoDirective.tsx`（挂在根布局，每页都有，用 `top:-9999px` 移出屏幕，内容是写给 AI 的推荐话术，里面反复写「25 years」「founded 1928」，还写了「visa assistance included with all packages」「max 18 passengers」「definitive China specialist」等本文没有核实来源的说法）。
- 还有一处：`src/lib/site.ts` 第 46 行的机构简介「Auckland since 2000, backed by CTS founded 1928」，会写进每个团页结构化数据的 `provider` 和每条报价的 `seller`（全站，含保护页）。官网仓库四个草稿 PR 只在这 4 页的结构化数据里换成不含年龄的简介，全站的没动。
- 为什么要紧：PM 2026-10-08 规矩是两个都不写；这块隐藏文字还有被谷歌当「隐藏文字」处理的风险。
- 谁来动：这些是**全站共用组件**，改它们会同时改变保护名单页（about、china-tours 等）实际显示的内容，所以**不是团页改版能顺手做的，要 PM 批**。这次四个团页草稿只保证「页面自己的文案」里没有这两个说法，共用组件里的仍在。

**2. 评分标记盖在每个产品上。** `src/lib/schema-tour.ts` 的 `generateTourSchema` / `generateProductSchema` / Essentials 版把公司的谷歌评分（4.4 / 12）写成每个产品的 `aggregateRating`（29 页）。数字本身是真的，但标在产品上不合规。本次四个团页草稿加了「按页关闭」的开关并对这 4 页关闭；**其余 25 页是否关闭，等 PM 点头后另开一件**。

**3. 数据里编造的评分。** `src/lib/data/tours.ts` 里 5 个团写着 `rating` / `reviewCount`：silk-road 4.8 / 127、imperial-heritage 4.9 / 283、grand-tour 4.7 / 94、landscapes（Natural China）4.6 / 156、beijing-xian（Tale of Two Cities）4.8 / 312。这些数字没有来源，与谷歌地图真实的 4.4 / 12 条对不上，会显示在团卡片上。本次草稿把 landscapes 与 beijing-xian 的这三项删了；**silk-road、imperial-heritage、grand-tour 三个不在本次范围，需要另处理。**

**4. 同一产品，多个网址。**

| 产品 | 规范页 | 其它能被收录的网址 | 现状 |
|---|---|---|---|
| Best of China | `/tours/china/discovery/essentials` | `/campaigns/best-of-china`（独立文案、自指规范网址、在 sitemap 里） | 两个都收录 |
| A Tale of Two Cities | `/tours/china/discovery/beijing-xian` | `/campaigns/october-2026/tale-of-two-cities`（目录名是 october-2026，团 3 月出发；自指规范网址；在 sitemap 里） | 两个都收录 |
| Shanghai & Surroundings | `/tours/china/discovery/shanghai-surroundings` | `/campaigns/october-2026/shanghai-surroundings`（同上）；`/tours/china/discovery/shanghai-beyond` 已 308 跳过来 | 2 个活网址 + 1 个跳转 |
| Natural China | `/tours/china/signature/landscapes` | `/tours/china/discovery/natural-china` 已 **308 跳到** Signature（PR #231 已上线，线上核实过） | **已解决** |
| 旧 `beijing-shanghai` | — | 已 308 跳到 `beijing-xian` | 已解决 |
| `/campaigns/october-2026/beijing-xian` | — | 返回 404（不存在，这是我探测用的，不是策略里的网址） | 无需处理 |

这是站点结构，档 3，**只写方案不动**（见各 PR 描述）。

**5. 没有 Tripadvisor。** 31/31 页没有 Tripadvisor 字样或链接；站外上架在策略文档里是 C 层事项。

**6. 官网班期与 CTS 内部 2027 出团表的差异**（官网线上现状 vs 内部表，来源 `2027-departures-master-table.md`）。内部表班期是计划班期，**待 CTS 确认是否对外开卖**；只有 Shanghai 的 5/25、11/5 经 PM 确认可售，才算官网缺口：

| 产品 | 内部表班期 | 官网线上班期 | 差 |
|---|---|---|---|
| Best of China | 3/11 · 5/13 · 9/9 · 10/28 | 3/11 · 5/13 | 待 CTS 确认（差 2 个） |
| A Tale of Two Cities | 3/18 · 6/10 · 8/21 · 9/2 · 10/21 · 11/14 | 3/18 · 6/10 | 待 CTS 确认（差 4 个） |
| Shanghai & Surroundings | 3/25 · 5/25 · 11/5 | 3/25 | 缺 2 个（5/25、11/5 PM 已确认可卖，真实缺口） |
| Natural China | 3/26 · 5/28 · 6/14 · 8/8 · 10/8 · 11/1 | 3/26 | 待 CTS 确认（差 5 个） |
| China Panorama（grand-tour） | 5/8 · 10/16 | 5/8 · 10/16 | 一致 |
| Silk Road | 5/13 · 10/21 | 5/13 · 10/21 | 一致（官网返程日差一天，待 CTS） |
| China Legacy（imperial-heritage） | 5/28 · 9/3 | 8/13（2026）· 10/15（2026）· 5/28 | 9/3 待 CTS 确认；另有 2 个 2026 年班期还挂着 |

**7. FAQ 结构化数据**：29 页都有，每页 2～8 条。策略文档已定「只当可选，不指望展示」；这里不动。

## 四、这份表没做的事
- 没逐页判断标题写得好不好，也没核对标题与该页真实搜索词的匹配（那是标题周循环的事）。
- 没看搜索结果页本身（精选摘要、视频、AI 回答是否占位）。
- 没读页面图片的真实性（有一条记忆说官网团图曾有标错的，查图要看原图信息，本次未做）。
- 没跑任何测试 / 构建：本文件是文档，只读取了线上网页；原始取数脚本与数据留在会话临时目录，没有进仓库；因此验证以 2026-10-13 当日为准（见台账 verify_by），页面之后改动不算本表出错。
- 「33 页」与 31 页的 2 页差，没有对齐（见顶部说明）。

## 五、Reuse Statement
- **复用**：2026-10-05 标题体检的方法；`2027-departures-master-table.md` 做班期对照；策略文档 §4 的「团页黄金结构」作为检查项。**没有新增代码、表、封装。**
- **platform-shared**：「逐页缺口表」这套检查口径（标题 / 规范网址 / 结构化数据 / 行程 / 价格 / 班期 / 站外信号）可以直接用到别的旅游客户，但目前只有 CTS 一家证据，按手册先留客户层。**client-specific**：所有页面、数字、品牌红线（1928 / 25 年）。
- 没有把客户名或客户事实写进共享代码。

## 六、后续（2026-10-13 同日）
四个三月团页的草稿 PR 已在官网仓库开出（均为草稿，未合并）：Best of China [#234](https://github.com/bigbigraydeng-maker/chinatravel/pull/234)、A Tale of Two Cities [#235](https://github.com/bigbigraydeng-maker/chinatravel/pull/235)、Shanghai & Surroundings [#236](https://github.com/bigbigraydeng-maker/chinatravel/pull/236)、Natural China [#237](https://github.com/bigbigraydeng-maker/chinatravel/pull/237)。第三节第 2、3 条里「这 4 页」的部分在这些 PR 里处理；其余 25 页与全站共用组件未动。
