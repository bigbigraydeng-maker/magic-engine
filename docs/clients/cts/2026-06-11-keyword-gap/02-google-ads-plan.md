# CTS Tours NZ · Google Ads 行业关键词广告计划

> **数据基础**：GSC 28 天 + master_brief.keyword_seeds + Best of China 行程城市 + ME industry baseline
> **DataForSEO gap 数据**：⚠️ 待 PM 在 ME 后台跑一次截图（v1 用 GSC + master_brief 出，v2 接入 DataForSEO 补 KD/Volume）
> **整体策略**：在现有"CTS — Three Tours + Brand Defense — Search"campaign 旁**新建独立 campaign**做行业获客

---

## 1 · 当前品牌 Campaign 必修 3 件事（先修再上行业）

| # | 操作 | 原因 |
|---|---|---|
| 1 | `china travel service` 广泛匹配 → **暂停**，新建 `"china travel service nz"` 词组 + `[china travel service new zealand]` Exact 替换 | 广泛匹配把香港 CTS 母品牌流量抓进来，6/10 那天 NZ$37.30 大部分浪费 |
| 2 | 暂停所有 `*hong kong* / *hk* / *sheung wan*` 关键词 + 加进否定词清单 | 永远不会转化的关键词。**截图确认 PM 已配 22 个否定词 ✅** |
| 3 | **验证 Conversion tracking 真的在收数据** — Google Tag Assistant 走完一遍 `/contact` 提交询盘流程 | 6/10 当天 9 点击 0 转化 — 要么 gtag 没装通，要么转化事件配错 |

---

## 2 · 行业 Campaign 总体结构（建议方案）

```
[Account] 105-817-1329 China Travel
  ├─ Campaign 1 (existing): CTS — Three Tours + Brand Defense — Search   [品牌防御]
  │     daily NZ$15 / Maximize clicks / 全 Exact+Phrase
  │
  └─ Campaign 2 (new): CTS — China Tours Industry — Search                [行业获客]  ⬅️ 本文档主体
        daily NZ$30 / Maximize clicks (Day 1-14) → tCPA (Day 15+)
        Locations: New Zealand, Presence only
        Languages: English
        ├─ AG_HighIntent     daily ~NZ$15  Exact+Phrase  → 落地页 /china-tours-from-new-zealand
        ├─ AG_BestOfChina    daily ~NZ$10  Exact+Phrase  → 落地页 /tours/china/discovery/essentials
        └─ AG_LongTail       daily ~NZ$5   Exact only    → 落地页 各城市 tour 页
```

**为什么独立 campaign 而不是加广告组到品牌 campaign**：
- 品牌词 CTR 30%+ / 转化路径 1 步 / Quality Score 高
- 行业词 CTR 3-8% / 转化路径 3-5 步 / Quality Score 中等
- 混在一起 Maximize clicks 算法会把预算全推给品牌词（看起来 CTR 高），行业词学不到数据
- 独立 campaign = 独立预算池 + 独立学习曲线

---

## 3 · AG_HighIntent（高转化意图，预算 NZ$15/日）

**意图**：用户已经知道想去中国 / 找服务商。

**关键词清单**（全部 Exact + Phrase 双投，**禁 Broad**）：

| 关键词 | 匹配 | 来源 |
|---|---|---|
| `[china tours from new zealand]` | Exact | GSC 桶 C 已排第 15.2 |
| `"china tours from new zealand"` | Phrase | |
| `[china tours from nz]` | Exact | GSC 桶 B 错位机会（第 9.4 / impr 273）|
| `"china tours from nz"` | Phrase | |
| `[china tours from auckland]` | Exact | GSC 桶 B（第 14.7 / impr 49）|
| `"china tours from auckland"` | Phrase | |
| `[small group china tours]` | Exact | master_brief.keyword_seeds |
| `"small group china tours nz"` | Phrase | |
| `[private china tours]` | Exact | 搜索词报告 6/10 用户搜的 |
| `"private china tours nz"` | Phrase | |
| `[china travel specialists nz]` | Exact | master_brief.keyword_seeds |
| `"china travel specialists nz"` | Phrase | |
| `[china tour packages including airfare from nz]` | Exact | GSC 桶 B（第 10.4 / impr 85 / CTR 5.9%）|
| `"best china tours from nz"` | Phrase | GSC 桶 B（第 12.8 / impr 75）|
| `"tours to china from nz"` | Phrase | GSC 桶 C（第 16.6）|

**总词数**：15 个（前期上限）

**Final URL**：`https://www.ctstours.co.nz/china-tours-from-new-zealand`

**预估 CPC**：NZ$2-5（competitive travel niche）
**预估月点击**：250-400

---

## 4 · AG_BestOfChina（PM 重点推团，预算 NZ$10/日）

**意图**：Best of China Essentials 15 天主推团 + 行程涉及的 4 个城市 + 主景点关键词。

**关键词清单**（基于 Best of China 行程：Beijing → Xi'an → Hangzhou → Shanghai）：

### 4.1 · 团 + 多城市组合（Phrase）

| 关键词 | 匹配 |
|---|---|
| `"best of china tour"` | Phrase |
| `"beijing xian shanghai tour"` | Phrase |
| `"beijing xian tour from nz"` | Phrase |
| `[best of china 15 days]` | Exact |
| `"china discovery tour"` | Phrase |
| `[china essentials tour]` | Exact |

### 4.2 · 4 个城市 + tour 后缀（Exact + Phrase）

| 城市 | Exact | Phrase |
|---|---|---|
| Beijing | `[beijing tours from nz]` | `"beijing tours kiwi"` |
| Xi'an | `[terracotta warriors tour]` | `"xian tours from nz"` |
| Hangzhou | `[hangzhou tours from nz]` | `"west lake tour"` |
| Shanghai | `[shanghai tours from nz]` | `"shanghai tours from auckland"` |

### 4.3 · 主景点（Exact，长尾高转化）

| 关键词 | 匹配 |
|---|---|
| `[great wall tour from new zealand]` | Exact |
| `[terracotta warriors xi'an tour]` | Exact |
| `"forbidden city guided tour"` | Phrase |
| `[temple of heaven tour]` | Exact |

**总词数**：~22 个

**Final URL**：`https://www.ctstours.co.nz/tours/china/discovery/essentials`

⚠️ **依赖事项**：先把 `/tours/china/discovery/essentials` 这页 SEO 修好（当前自然排名第 41 位，meta/H1/canonical 必须先 audit + 重写），否则 Quality Score 会低 → CPC 会被罚高。

---

## 5 · AG_LongTail（教育 + 信息阶段，预算 NZ$5/日）

**意图**：Kiwi 处于研究阶段，还没确定服务商。这阶段用 Ads 抢 cookie + 加 remarketing pixel，30 天后用 display remarketing 转化。

**关键词清单**：

| 关键词 | 匹配 | 落地页 |
|---|---|---|
| `[china visa free entry nz 2026]` | Exact | /blog/china-visa-free-nz-2026 |
| `"china visa for new zealanders"` | Phrase | /china-visa-guide-for-new-zealanders |
| `[best time to visit china]` | Exact | /best-time-to-visit-china |
| `"china travel guide new zealanders"` | Phrase | /china-tours-from-new-zealand |
| `[is china safe for tourists 2026]` | Exact | （需新建 blog 落地页）|
| `[china cultural tours]` | Exact | （指 /tours 主页 + #culture anchor） |

**总词数**：6 个

⚠️ **AG_LongTail 不强求转化** — 这是品牌曝光 + remarketing 漏斗入口。KPI 是 click cost < NZ$1.5 + 进 remarketing audience。

---

## 6 · 否定关键词清单（Campaign-level）

✅ **已配 22 个**（从你 6/10 截图确认）：tripadvisor / business visa china / reddit / youtube / cts logistics / cts brake / cts software / cts pads / branches / hk / hk ltd / hong kong / sheung wan + 8 个未截图全的。

**还需要加的（行业 campaign 上线前补）**：

```
# 通用屏蔽（已部分加）
free
jobs
career
salary
wikipedia
youtube
reddit
tripadvisor

# 业务边界外
china visa application（CTS 不办签证）
china embassy
study in china
work in china
business visa china（已加 ✅）
expat china
china property
china investment

# 错误对应
cts brake（已加 ✅）
cts pads（已加 ✅）
cts software（已加 ✅）
cts logistics（已加 ✅）
cts auto
cts gas

# 香港 CTS（已加 ✅）
hong kong
hk
hk ltd
sheung wan
branches

# 竞品防御（按 master_brief.competitor_domains 中 wendy wu）
# ⚠️ 暂不加，PM 拍板要不要打竞品防御战
# wendy wu
# wendywu
```

---

## 7 · RSA 广告文案（每 Ad Group 1 条）

### 7.1 · AG_HighIntent RSA

**15 Headlines**（必须从 master_brief.core_proposition 取，不能编）：

```
品牌名 (3):
1. CTS Tours NZ — China Specialists
2. New Zealand's China Tour Experts
3. Kiwi-Owned China Travel Specialists

主关键词 (3):
4. China Tours from New Zealand
5. Small Group China Tours from NZ
6. Private China Tours for Kiwis

USP (3, 从 core_proposition 取):
7. Direct On-Ground Operations in China
8. Authentic China, Not Tourist Traps
9. Trusted by Kiwis Since 1928

CTA (3):
10. Get a Free China Itinerary
11. Talk to a China Specialist Today
12. Book Your China Tour from NZ

地域 (3):
13. Departing from Auckland Direct
14. Designed for New Zealand Travellers
15. For Kiwis, By Kiwis Since 1928
```

**4 Descriptions**：

```
1. Experience China seamlessly with NZ's oldest China travel specialist. Small groups, expert local guides, and 98 years of trust. Free itinerary advice.

2. Beijing, Xi'an, Shanghai, Guilin, and beyond — discover authentic China with a Kiwi-owned specialist. Visa-free entry now available for NZ passports.

3. Direct operations in China mean no middlemen, no surprises, just expertly crafted journeys. Get a free itinerary from our China specialist team.

4. From the Great Wall to the Terracotta Warriors, plan your China adventure with the team Kiwis have trusted since 1928. Book your free consultation today.
```

**Final URL**：`https://www.ctstours.co.nz/china-tours-from-new-zealand`

**Display URL paths**：`/china-tours` `/from-new-zealand`

⚠️ **禁用词复查**：`best` `#1` `guarantee` `cheapest` — 不用，避免 policy 拒登（CTS 6/10 已经踩过 Capitalisation 拒登）。"trusted" "expertly" "authentic" 可以用。

### 7.2 · AG_BestOfChina RSA（针对 Best of China 15 天团）

**15 Headlines**：

```
1. Best of China — 15 Days, 4 Cities
2. Beijing Xi'an Shanghai Tour from NZ
3. China Discovery for Kiwis: NZD $3,880
4. 15-Day Best of China Tour from Auckland
5. Great Wall + Terracotta Warriors Tour
6. Beijing Forbidden City Guided Tour
7. Xi'an Terracotta Warriors with Kiwi Guide
8. Shanghai Bund Tour from New Zealand
9. Hangzhou West Lake Tour Included
10. Small Group: Max 16 Kiwis per Tour
11. CTS Tours NZ — 98 Years of Trust
12. Book Your 2026/27 China Tour
13. Departures Nov 2026 – Mar 2027
14. Free Itinerary from China Specialist
15. NZ Visa-Free Entry — 30 Days Confirmed
```

**Final URL**：`https://www.ctstours.co.nz/tours/china/discovery/essentials`

### 7.3 · AG_LongTail RSA（教育型）

**15 Headlines**：

```
1. NZ Passport China Visa-Free 2026
2. 30 Days Visa-Free for Kiwis to China
3. Plan Your First China Trip from NZ
4. Best Time to Visit China — Kiwi Guide
5. Is China Safe for Kiwi Travellers?
6. China Travel Guide for New Zealanders
7. China Cultural Tours for Kiwis
8. Authentic China Without Tourist Traps
9. NZ's Trusted China Travel Specialists
10. CTS Tours — Kiwi-Owned Since 1928
11. Talk to a China Specialist for Free
12. Get a Free China Travel Consultation
13. Beijing, Shanghai, Xi'an Travel Tips
14. Small Group Tours for First-Timers
15. From Auckland to China — We Plan It All
```

---

## 8 · Day 1-14 出价策略（学习期）

| 阶段 | Campaign | Bidding | Daily Budget | 触发动作 |
|---|---|---|---|---|
| Day 1-14（学习期）| Campaign 2 (Industry) | Maximize clicks | NZ$30 | 不调出价 / 不加词 / 不删词 / 不接 Google 推荐 |
| Day 15-28（验证期）| Campaign 2 | Maximize conversions | NZ$30 | 转化数 ≥ 20 才切换 |
| Day 29+（优化期）| Campaign 2 | tCPA, target = (avg lead value × 30%) | NZ$30-50 | 按 Search terms report 拓词 + 否定词 |

**触发紧急暂停**：
- 单日花费 > NZ$60（预算 200%）
- CTR < 2% 持续 3 天
- 出现 ≥ 5 个错误地区 / 错误业务搜索词

---

## 9 · Conversion Tracking 必须先修

⚠️ **当前问题**：6/10 那天 9 点击 0 转化。可能性：

1. gtag 未装到客户域名 `/contact-success` 页（违反红线 — gtag 必须装客户域名，不装 ME 域名）
2. Conversion goal 配错（点 contact 按钮 vs 提交 form vs 收到 email 三选一没分清）
3. Form 提交后没跳转到独立 `thank-you` 页 — gtag fire 不了

**操作清单**（PM 走完才能上 Campaign 2）：

- [ ] Google Ads → Tools → Conversions → 确认 Primary Conversion = `Contact Form Submit`
- [ ] Conversion Action 设置 → Source = Google tag 或 Google Tag Manager
- [ ] PM 装好 gtag 在 `https://www.ctstours.co.nz/thank-you` 页（这页 `/thank-you` 已经在 site-map 里 ✅）
- [ ] 用 Google Tag Assistant 走一遍：访问首页 → 点 Contact → 填 form → 提交 → 跳 /thank-you → 看到 "Conversion fired" 绿勾
- [ ] 24h 后 Google Ads 后台 Conversions 列出现真实数字（不是 "—"）

---

## 10 · 预期产出（Campaign 2 上线后 30 天）

| 指标 | 预期范围 |
|---|---|
| 月花费 | NZ$900（每日 NZ$30 × 30）|
| 月点击 | 400-700 |
| 月展示 | 12,000-20,000 |
| 月转化（询盘）| 12-25（按 3-4% conversion rate） |
| CPA（单次询盘成本）| NZ$36-75 |
| CPL → 单团成交率（按行业估）| 5-10% |
| 月预估成单 | 1-3 团（每团均价 NZ$3,880 + 利润率 ≈ NZ$300-1,500 净利 / 团） |

**ROI 临界值**：1 团成单 ≈ 覆盖 1 个月 Campaign 2 总成本（NZ$900）。

---

## 11 · 下一步（PM 确认）

请逐条 OK / NOT-OK：

1. **修品牌 campaign 3 件事**（暂停广泛 + 加否定词 + 验证 conversion） → ?
2. **建独立 Campaign 2 行业获客**（结构 + 3 个 Ad Group + 否定词清单） → ?
3. **15 + 22 + 6 = 43 个关键词**全部 Exact + Phrase 投，**禁 Broad** → ?
4. **3 个 RSA 文案** 直接用还是 PM 改一版？ → ?
5. **conversion tracking 修复** 走完 PM 才能上 Campaign 2 → 确认 ?
6. **预算 NZ$30/日 = NZ$900/月** → ?

确认后**下一步**：①PM 在 ME 后台跑一次 keyword gap 截图给我 → 我补 DataForSEO KD/Volume 数据 → v2 关键词清单完善 ②Step 6 拆 SEO 改写文档 + SEO 内容 backlog 文档
