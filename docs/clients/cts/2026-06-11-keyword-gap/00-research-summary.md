# CTS Tours NZ · 行业关键词广告计划 + 落地页配合 · 调研总报告

> **日期**：2026-06-11 NZST
> **客户**：CTS Tours NZ（c0000000-0000-0000-0000-000000000000）
> **域名**：ctstours.co.nz
> **市场**：NZ（Auckland based / national scope）
> **行业**：tourism_operator / outbound_tour_operator_nz
> **执行人**：诸葛亮（Ads 模块） · 子牙复审
> **触发**：PM 6/10 已在 Google Ads 上线品牌 Campaign（NZ$59.91 第一天），要扩到行业关键词
> **数据来源**：
> - Google Search Console 28 天（gsc_performance_snapshots）
> - master_briefs（CTS 真实业务方向）
> - clients.competitor_domains（CTS 配的 19 个竞品）
> - ME industry_benchmarks（tourism_operator AU_NZ 基准）
> - ME baseline_domains（22 家 tourism 同行）
> - CTS 网站 88 个 public route（本地 git 仓 src/app）
> - Best of China Essentials 行程（ctstours.co.nz/tours/china/discovery/essentials）
> ⚠️ **缺**：DataForSEO keyword gap（已请 PM 在 ME 后台 UI 跑一次截图给我，v2 补齐）

---

## 一、PM 7 个问题逐条答复

### Q1 · "通过 API 链接 DataForSEO 查看 CTS 行业 keyword gap"

**答**：ME 后台已经有 endpoint `GET /api/clients/{id}/seo-intelligence/competitors-gap` ，它会自动用 CTS 配的 19 个 competitor_domains 跑 DataForSEO domain_intersection，返回 100 个 untapped gap keywords + KD/Volume/Intent。**已请 PM 在 ME 后台 SEO Intelligence 模块跑一次，截图给我**。v1 这版报告先用 GSC + master_brief 出（已经够建一个完整广告 + 落地页方案），v2 接入 DataForSEO 数据补 KD/Volume 精度。

**ME industry baseline 真实数据**（已查到）：
- **行业基准**（tourism_operator AU_NZ）：SEO p50=42 / p75=62 / p90=78
- **CTS 当前 SEO 分**：16 — 低于 p50，**严重落后**
- **同细分赛道**（outbound_tour_operator_nz）：wendywutours.co.nz (16) / worldjourneys.co.nz (20) / **ctstours.co.nz (16)** / rdtravel.co.nz (14)
- **CTS = 第二梯队**（跟 wendy wu 同分，落后 worldjourneys 4 分）

---

### Q2 · "网站对应的 blog / guide / 落地页都要怎么写"

**答**：CTS 站点已经有完整 SEO 地基（88 个 public route，包括 9 个城市 tour 页 + 16 个城市 guide + 5 个景点 guide）。重点不是新建大量页，而是：

1. **改写 5 个错位高潜力页**（详见 `03-page-rewrites.md`）：
   - `/blog/china-visa-free-nz-2026`（最高 ROI，+180 clicks/月）
   - `/china-visa-guide-for-new-zealanders`
   - `/tours/china/discovery/essentials`（**Best of China 当前排第 41 位 — 致命问题**）
   - `/china-tours-from-new-zealand`
   - `/china-tours`

2. **新建 6 个专题 blog**（详见 `04-seo-content-backlog.md`）：
   - china-tour-packages-including-airfare-from-nz
   - is-china-safe-for-kiwi-travellers-2026
   - best-china-tours-for-first-time-kiwi-travellers
   - beijing-shanghai-xian-itinerary-15-days-kiwi-edition
   - private-china-tours-vs-small-group-which-is-better-for-kiwis
   - visa-free-china-vs-15-day-vs-30-day-policy-comparison

---

### Q3 · "DataForSEO 查 KD<20 / Volume>100 transactional / commercial 机会词 + cross 对比 CTS 现有页面"

**答**：v1 这版用 GSC 真实搜索数据 cross 出 8 个错位机会词（见 `01-gsc-signal-buckets.md` 桶 B）。这 8 个 28 天合计 impr 2,938 / clicks 51（CTR 1.7%），如果 CTR 拉到行业平均 4% → +66 clicks/月**纯自然流量增益**。

v2 接入 DataForSEO 后会补 100 个 untapped keyword 的精确 KD / Volume / CPC 数据。

机会词跟 88 站点页 cross 比对的 3 分桶：
- ✅ **有页对应**（8 词）→ 直接当 Ads 落地页 + SEO 改写
- ⚠️ **有泛页但缺专题**（4 词）→ 加 anchor section + FAQ
- ❌ **完全没专题页**（6 词）→ Phase 1 新建 6 篇 blog

---

### Q4 · "重点推 Best of China 团（行程在 /tours/china/discovery/essentials），城市和项目是重点关键词"

**答**：✅ 已纳入广告计划核心。

**Best of China 行程真实信息**（已 WebFetch 验证）：
- **15 天** / NZD $3,880 起
- **4 城**：Beijing → Xi'an → Hangzhou (via Puyuan) → Shanghai
- **主要景点**：Forbidden City / Great Wall / Hutong / Terracotta Warriors / Xi'an City Wall / West Lake / Yuyuan Garden / The Bund / Nanjing Road
- **departure**：2026-11-03 → 2027-03-25

**已建独立 Ad Group `AG_BestOfChina`**（详见 `02-google-ads-plan.md` Section 4），22 个关键词：
- 团 + 多城市组合：`"best of china tour"` / `"beijing xian shanghai tour"` / `[best of china 15 days]` 等
- 4 个城市 tour 后缀：`[beijing tours from nz]` `[terracotta warriors tour]` `[hangzhou tours from nz]` `[shanghai tours from nz]`
- 景点：`[great wall tour from new zealand]` / `[terracotta warriors xi'an tour]` / `"forbidden city guided tour"` / `[temple of heaven tour]`

⚠️ **依赖事项**：先把 `/tours/china/discovery/essentials` 这页 SEO 修好（当前 GSC 自然排第 41 位 — meta/H1/canonical 必须先 audit + 重写），否则 Quality Score 低 = CPC 会被罚高。详见 `03-page-rewrites.md` 改写 #3。

---

### Q5 · "跟竞争对手对比看 untapped keyword + 对应官网内容 + 广告关键词机会"

**答**：v1 这版从 ME industry_baseline 拿到 22 家 tourism 同行（含 19 家 CTS 配的 competitor_domains），其中 NZ outbound 直接对标的有 3 家：
- **wendywutours.co.nz** (seo_score=16，跟 CTS 同分)
- **worldjourneys.co.nz** (seo_score=20，**领先 CTS 4 分**)
- **rdtravel.co.nz** (seo_score=14)

**untapped keyword 推断**（v2 接 DataForSEO domain_intersection 拿精确清单）：
- "wendy wu china tours" 6/10 已经在 CTS Ads 后台搜索词报告里出现（impr 4 / 用户搜竞品名误进 CTS 站）→ 这是**竞品防御**机会，但 PM 需要拍板要不要做（打竞品名字会引战）
- "tripadeal china" 同样出现 → tripadeal 不在 ME baseline 里，是大众市场竞品，CTS 不应直接对打
- worldjourneys 的"private china tours" 类长尾页可能是 untapped — v2 DataForSEO 确认

**v2 行动**：PM 截图 ME 后台 keyword gap 后，我会补一份精确 untapped keyword 清单，cross 出每个词对应"该改哪页 / 该新建哪页 / 该投哪个 Ad Group"。

---

### Q6 · "当前官网内 visa-free 页面带来的流量如何？这是一个很好的点"

**答**：✅ 完全同意。**visa-free 是 CTS 当前最大 untapped ROI 来源**。

**真实数据**（28 天 GSC）：
| Page | Position | Impressions | Clicks | CTR | 评估 |
|---|---:|---:|---:|---:|---|
| /blog/china-visa-free-nz-2026 | 9.1 | **5,153** | 18 | 0.35% | 🔥 第 9 位但 CTR 异常低 |
| /china-visa-guide-for-new-zealanders | 9.2 | **1,808** | 16 | 0.89% | 同 |
| **合计** | | **6,961** | 34 | 0.49% | 站点 Top 5 impressions topic |

**判断**：
- visa-free 是 CTS 站点 28 天 **最高 impressions 的 topic**（合计 6,961 — 占站点总 impr 50,531 的 **13.8%**）
- 但 CTR 只有 0.49%（比行业平均 4% 低 8 倍）
- **如果 CTR 拉到 4%** → 34 → 278 clicks/月 → **+244 clicks/月**（CTS 站点 ROI 最高的一次改写）

**为什么 CTR 这么低**（推断，需 PM 打开 view-source 验证）：
1. `<title>` 没有强 CTA + 时间感数字（应该是 "2026 China Visa-Free Entry for NZ Passports: 30 Days Confirmed"）
2. `<meta description>` 不够吸引（应该 "NZ passport holders now visa-free 30 days. We've helped 1000+ Kiwis since 1928. Free advice →"）
3. 没有 FAQ Schema（影响 Google AI Overview 引用）
4. 没有内链转到 tour 页（流量进来不转化）

**详细改写方案**：见 `03-page-rewrites.md` 改写 #1 + #2（含完整 title/meta/H1/JSON-LD/CTA 模板）。

⚠️ **不建议把 visa-free 页作为 Google Ads 落地页** — visa-free 搜索意图是 informational，付费引流转化率会很低。**走 SEO 自然流量 + remarketing pixel** 把这批人养起来再转。但**可以在 AG_LongTail 里投 `[china visa free entry nz 2026]` 这词，落地到这页**，目的是抓 remarketing audience。

---

### Q7 · "整理成 SOP，其他客户也是这个流程来执行"

**答**：✅ 已写完 SOP `docs/sops/keyword-gap-attack-playbook.md`（v1.0）。

SOP 7 步：
1. 拉 GSC 28 天真实搜索情报（4 个信号桶 A/B/C/D）
2. 拉 ME industry baseline 拿行业天花板
3. ME 后台跑 keyword gap（DataForSEO 自动接入）
4. 筛 KD<20 / Volume>100 / commercial+transactional
5. Cross 比对客户现有页面 → 缺口分类
6. 写广告 + 落地页 + SEO 内容三件套
7. 写 Airtable Decisions Log + ROADMAP 登记

**触发节奏**：新客户接入第 8-14 天 + 已有客户每月 1 日 + 行业重大变动 / Google 算法更新后。

**适用范围**：CTS / Oztop / 任何 FDE 月付客户 + self-serve 客户（接 Google Ads + SEO 内容飞轮）。

---

## 二、CTS 立刻可执行的行动清单（PM 拍板）

按 ROI 降序，PM 逐条 OK / NOT-OK：

| 优先级 | 行动 | 工时 | 预估 30 天增益 | 状态 |
|:---:|---|---|---|---|
| **1** | 改写 `/blog/china-visa-free-nz-2026`（详见 03 #1）| 2.5h | +180 clicks/月 SEO | ⏳ 待 PM OK |
| **2** | 改写 `/china-visa-guide-for-new-zealanders` | 2h | +60 clicks/月 SEO | ⏳ 待 PM OK |
| **3** | 修品牌 Campaign 3 件事（暂停广泛词 + 加否定词 + 验证 conversion）| 30 min | 防 NZ$30+/月浪费 | ⏳ 待 PM OK |
| **4** | 改写 `/tours/china/discovery/essentials`（Best of China 救回排名）| 4h | +15 clicks/月 + Ads QS 上升 | ⏳ 待 PM OK |
| **5** | 建独立 Campaign 2 行业获客（AG_HighIntent + AG_BestOfChina + AG_LongTail，43 词）| 3h | 月预算 NZ$900 / 月 lead 12-25 | ⏳ 待 PM OK + Conversion 修好 |
| **6** | 改写 `/china-tours-from-new-zealand` 加长尾 + FAQ | 2.5h | +20 clicks/月 SEO | ⏳ 待 PM OK |
| **7** | 改写 `/china-tours` | 2.5h | +30 clicks/月 SEO | ⏳ 待 PM OK |
| **8** | PM 在 ME 后台跑 keyword gap 截图 | 10 min | v2 关键词清单更精确 | ⏳ 待 PM 操作 |
| **9** | 新建 6 篇 Phase 1 blog | 12h FDE 工时 | +200 clicks/月 SEO | ⏳ 待 PM OK |

**合计 30 天 SEO 增益预估**：**+505 clicks/月**（不烧 Ads，纯自然流量），约 **+80% 站点总流量**

**Campaign 2 预估**：月花费 NZ$900 / 月点击 400-700 / 月询盘 12-25 / 单询盘成本 NZ$36-75

---

## 三、关键风险 + 红线复述

1. 🔴 **conversion tracking 6/10 没记数据** — 必须 PM 先修，否则 Campaign 2 上线后看不出真实效果
2. 🔴 **gtag 必须装在客户域名 ctstours.co.nz** — **绝禁** 装在 ME 域名（违反红线）
3. 🔴 **所有 Ads 关键词 Exact + Phrase，禁 Broad** — 6/10 已踩 Broad 坑（22% 预算被香港 CTS 母品牌瓜分）
4. 🔴 **不在 RSA 用 `best` `#1` `guarantee`** — 6/10 已踩 Capitalisation 拒登坑，policy 收紧
5. 🔴 **数字来源必须真实**：所有 KD / Volume / CPC 都要等 PM 在 ME 后台 DataForSEO UI 跑出来回填，**v1 这版没有编**
6. 🔴 **master_brief 内容混乱**：CTS 客户记录里有一条把 brand_name 写成 "CTS to US"，target_audience 是 "US college admissions" — 这是错误数据混入（可能是另一个客户记录），需要 PM 清理。当前调研全部基于**正确那条记录**（brand_name=CTS Tours, target_audience=NZ Kiwi 35-70 China travellers）。

---

## 四、附件清单

| 文件 | 内容 |
|---|---|
| `00-research-summary.md` | 本文档（总报告）|
| `01-gsc-signal-buckets.md` | GSC 28 天 4 个信号桶 + visa-free 专项 |
| `02-google-ads-plan.md` | Campaign 2 完整结构 + 43 关键词 + 3 RSA 广告 + 否定词 |
| `03-page-rewrites.md` | 5 个高 ROI 落地页改写（title/meta/H1/Schema/内链） |
| `04-seo-content-backlog.md` | Phase 1 6 篇 blog backlog + Phase 2 候选 |

**SOP（可复用其他客户）**：`docs/sops/keyword-gap-attack-playbook.md`

---

## 五、PM 下一步（按顺序）

1. 看完本报告 → 逐条 OK / NOT-OK 上述 9 个行动
2. **进 ME 后台 CTS 客户页 → SEO Intelligence → Keyword Gap → 跑一次 → 截图给我** → 我补 DataForSEO 精确数据出 v2
3. **修 conversion tracking**（30 min，PM 手动）
4. PM 决定 Campaign 2 是不是这周末上 → 上 = 我接着出 Ad 上线 checklist + 监控规则
5. 5 个落地页改写谁来改？FDE 排期？还是子牙调 Codex 做？
6. **同步 Airtable Decisions Log**（我已经把记录写好准备发，等 PM 点头）

---

**报告完。等 PM 反馈。**
