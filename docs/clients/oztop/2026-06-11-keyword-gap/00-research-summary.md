# Oztop Building Supplies · 行业关键词广告计划 + 落地页配合 · 调研总报告

> **日期**：2026-06-11 NZST
> **客户**：Oztop Building Supplies（d5c98811-1c1d-4ded-bdf0-4cefec6afb84）
> **域名**：oztopbuildingsupplies.com.au
> **地理**：Slacks Creek QLD 4127（Brisbane south-east / Logan）
> **市场**：AU（business_scope = local）
> **行业**：flooring / tiles / carpet / bathware（专业建材零售 + 装修商 B2B）
> **执行人**：诸葛亮（Ads 模块） · 子牙复审
> **触发**：PM 跑 ME 后台 Oztop SEO Intelligence 给 4 张截图，要按 CTS SOP 同流程跑 Oztop
> **数据来源**：
> - Google Search Console 28 天（gsc_performance_snapshots）
> - master_briefs（Oztop 真实业务方向）
> - clients（primary_keywords / competitor_domains / brand_aliases）
> - ME industry baseline tourism_operator（**没有 flooring 行业基准** — bug）
> - Oztop 网站完整 sitemap（22 product-category 页 + 31 brand 页 + 5 project 案例）
> - ME 后台 4 张截图（Organic Rankings / Intent Priority / Top Pages / 竞品对比）
> ⚠️ **缺**：DataForSEO 行业 keyword gap（截图显示竞品全部"0 共同词"，配错了）

---

## 一、PM 7 个问题逐条答复（仿 CTS 结构）

### Q1 · "通过 API 链接 DataForSEO 查看 Oztop 行业 keyword gap"

**答**：
- ME 后台 endpoint `/api/clients/{id}/seo-intelligence/competitors-gap` 已经跑了
- 但 **竞品配置错了**：截图显示 #1 Bunnings (34.8M 月流量) / #2 Beaumont Tiles (593K) / #3 Reece (858K) / #4 TileTrends 等，全部跟 Oztop 共同词 0
- 这不是 untapped — 这是**根本不在同一赛道**（Bunnings 是 DIY 超市，跟专业地板供应商 Oztop 重叠极小）

**给 PM 的解决路径**（PM 已选 B）：
- **跳过竞品 gap 这步，直接用 GSC 真实数据 + Oztop 现有页面出方案**

后续 PM 需要：
- 提供 Oztop 真实竞品（Brisbane 本地的专业 flooring / tiles 供应商）
- 重新配 `clients.competitor_domains` → 重跑 keyword gap
- 候选竞品建议（待 PM 拍板）：
  - National Tiles
  - Tile Republic
  - Floorworld (已在配置但要验证)
  - The Flooring Guys (已在配置)
  - Beacon Lighting (跨业务，不算)
  - 本地 Brisbane flooring 小型供应商

---

### Q2 · "网站对应的 blog / guide / 落地页都要怎么写"

**答**：Oztop 站点结构 = **WordPress + WooCommerce**（推测 — 待 PM 确认）：
- 22 个 product-category 页（flooring/carpet/tiles/bathware 大类 + 子类）
- 31 个 brand 页
- 5 个 project 案例
- 3 篇真实 blog 已上线（tile-sizes / expansion-gap / tile-finishes）

**重点**：
1. **改写 6 个错位 / 致命问题页**（详见 `03-page-rewrites.md`）：
   - `/tile-sizes-explained-...`（最高 ROI，+60 clicks/月）
   - `/product-category/flooring/spc-wpc-hybrid-flooring/`（**当前 GSC 排第 49 — 致命问题**）
   - `/brand/preference-floors/` `/brand/nfd/` `/brand/kdk/`（brand 页改造）
   - `/tile-finishes-gloss-lappato-...`

2. **批量改造 31 个 brand 页**（套模板一次改完）

3. **新建 6 个专题 blog**（详见 `04-seo-content-backlog.md`）

---

### Q3 · "DataForSEO 查 KD<20 / Volume>100 transactional / commercial 机会词 + cross 对比 Oztop 现有页面"

**答**：v1 这版用 ME 后台截图 + GSC 真实数据 cross：

**5 个 transactional 高潜力词**（已识别）：
| 词 | DF Pos | Vol | 当前页 | 行动 |
|---|---:|---:|---|---|
| preference flooring | 33 | 1.3K | /brand/preference-floors/ | 🔥 brand 页改造 + Ads |
| nfd | 22 | 880 | /brand/nfd/ | 🔥 同 |
| kdk bathroom | 24 | 390 | /brand/kdk/ | 🔥 加 H1 "KDK Bathroom Brisbane" |
| elegance oak | 77 | 170 | （需新建） | ❌ 系列名，待 PM 确认是否经营 |
| lappato finish | 13 | 90 | /tile-finishes-... | 🔥 改 title 包含 lappato |

**桶 B 错位机会**（GSC 已排第 5-15 但 CTR 低）：
- tile-sizes-explained 页（impr 1,256 / CTR 1.9%）
- expansion gap flooring 页
- engineered timber flooring brisbane（pos 11 / 已 100% CTR，需升排名）

**桶 D 完全没接住**（高 impressions / 0 clicks）：
- spc-wpc-hybrid-flooring 母类页（pos 49.3 / impr 302）— 致命
- 大量 brand 页（diytiles / redbook-carpets / lauxes-grates / karndean / mapei / preference-floors / caroma 等 31 个）
- 大量瓷砖尺寸计算 informational 长尾（1200+600 / 600x1200 / 等 100+ 0-click 词）

---

### Q4 · "重点推 _____ ?"（CTS 是 Best of China 团 — Oztop 等价物是？）

**答**：
**需要 PM 确认 Oztop 的重点推广目标产品**。从 master_brief 推断可能是：
1. **SPC Hybrid Flooring**（primary_keywords 出现 spc/spc floor）— 最可能
2. **Authorised Brand Dealer**（Preference Floors / NFD / KDK / Karndean）— 商业价值高

**当前广告计划**（`02-google-ads-plan.md`）已经把 SPC Hybrid + Brand Dealer 都作为重点 Campaign。

**等 PM 确认**：是不是这两个方向？还是有别的重点品类（如某新引进的 brand / 季节性 promo）？

---

### Q5 · "跟竞争对手对比看 untapped keyword + 对应官网内容 + 广告关键词机会"

**答**：⚠️ **竞品配置错误**（见 Q1）。当前 ME 后台 keyword gap 数据**不可用**：

- 5 个配置的竞品共同词全部 0
- 7 个缺口词大部分跟 Oztop 业务无关（carpet cleaning / public bathrooms near me / rug and rug / rugs）

**真正 untapped 关键词**只能从 GSC 推导：
- 大量瓷砖尺寸数学搜索（1200+600 / 600x1200 / 300x600 等 100+ 个 0 click 词）
- 5 个 transactional brand 词
- Brisbane + 产品组合长尾

**待 PM 重配竞品后**：v2 报告会接入精确 KD / Volume 数据。

---

### Q6 · "当前官网内某高潜力页流量如何"（CTS 问的是 visa-free，Oztop 等价是？）

**答**：Oztop 真实 GSC 数据按 ROI 排：

| Page | Pos | Impr (28d) | Clicks (28d) | CTR | 评估 |
|---|---:|---:|---:|---:|---|
| / | 7.3 | 758 | 85 | 11.2% | ✅ 首页表现极好 |
| **/tile-sizes-explained-...** | **7.2** | **1,256** | **24** | **1.9%** | 🔥 **最高 ROI 改写目标** |
| /brand/bigpandaflooring | 6.5 | 395 | 8 | 2.0% | ⚠️ brand 页 CTR 偏低 |
| /understanding-expansion-gaps-... | 12.4 | 402 | 4 | 1.0% | ⚠️ informational, 改 FAQ |
| **/product-category/.../spc-wpc-hybrid-flooring/** | **49.3** | **302** | **1** | **0.3%** | 🔴 **致命问题** |
| /tile-finishes-gloss-lappato-... | 11.2 | 331 | 1 | 0.3% | ⚠️ CTR 致命 |
| /brand/diytiles | 32.3 | 180 | 0 | 0% | ⚠️ |
| /brand/redbook-carpets | 15.9 | 159 | 0 | 0% | ⚠️ |
| /brand/lauxes-grates | 41.2 | 89 | 0 | 0% | ⚠️ |

**最大金矿**：`/tile-sizes-explained-...` 排第 7 / impr 1,256 但 CTR 1.9%（行业 5%+）。**改 title + FAQ Schema 立即起量**。

**最严重致命问题**：`/product-category/flooring/spc-wpc-hybrid-flooring/` 排第 49 — Oztop 主线产品的入口页用户根本看不到。

---

### Q7 · "整理成 SOP，其他客户也是这个流程来执行"

**答**：✅ 已完成 SOP `docs/sops/keyword-gap-attack-playbook.md`（CTS 那次写的，本次 Oztop 用同一份 SOP 跑）。

**本轮 Oztop 跑下来对 SOP 的反馈**：
- Step 3（ME 后台跑 keyword gap）**前提是客户 competitor_domains 配对了** — Oztop 配错了导致这一步空跑。
- 加一条 SOP 前置 check：**Step 0.5 验证客户 competitor_domains 不是 GENERIC_DOMAIN_BLOCKLIST 类（Bunnings/Reece/Amazon/Bunnings 等）**。
- SOP v1.1 待补（下一轮升级时）

---

## 二、Oztop vs CTS — 关键差异对比

| 维度 | CTS | Oztop |
|---|---|---|
| 市场 | NZ（national）| AU（local, Brisbane）|
| 业务模式 | Outbound 旅游服务 | 本地零售 + B2B 建材 |
| 客单价 | NZ$3,500-8,000 / 团 | AU$50-50,000+（瓷砖 → 整套装修）|
| 转化路径 | 询盘 → 14-90 天定团 | Free measure → showroom → 7-30 天成单 |
| Conversion event | 1 个（contact form）| 4 个（free measure / quote / phone / WhatsApp）|
| Ads Campaign 数 | 2 个（品牌防御 + 行业获客）| 4 个（B2C / B2B / Brand defense / Brand dealer）|
| 月预算建议 | NZ$900 | AU$2,100 |
| Schema 主类型 | TouristTrip | Product / ProductGroup |
| 主关键词风格 | "china tours from NZ" 类长尾 | "{Brand} brisbane" / "{spec} mm" |
| 季节性 | 强（Nov-Mar departure 高峰）| 弱（装修全年）|
| CTR 当前情况 | 站点平均 1.25%（visa-free 0.5% 是大坑）| 站点平均 2.25%（首页 11.2% 是亮点） |
| 28 天总点击 baseline | 630 | 152 |
| 28 天总曝光 baseline | 50,531 | 6,760 |
| 真实位置 | 14.5 平均位 | 18.77 平均位 |

---

## 三、Oztop 立刻可执行的行动清单（PM 拍板）

按 ROI 降序，PM 逐条 OK / NOT-OK：

| 优先级 | 行动 | 工时 | 预估 30 天增益 | 状态 |
|:---:|---|---|---|---|
| **1** | 改写 `/tile-sizes-explained-...`（最高 ROI）| 3.5h | +60 clicks/月 | ⏳ 待 PM OK |
| **2** | 改写 `/product-category/flooring/spc-wpc-hybrid-flooring/`（救致命 SEO）| 5h | +50 clicks/月 + Ads QS 上升 | ⏳ 待 PM OK |
| **3** | 改写 3 个 brand 页（Preference / NFD / KDK）| 6.5h | +60 clicks/月 | ⏳ 待 PM OK |
| **4** | 批量改造 31 个 brand 页（模板一次套用）| 9h | +80 clicks/月 | ⏳ 待 PM OK |
| **5** | 改写 `/tile-finishes-gloss-lappato-...` | 2.5h | +10 clicks/月 | ⏳ 待 PM OK |
| **6** | **PM 确认 Google Ads 现状**（已上线 / 未上线）| 5 min | - | 🔴 BLOCKING |
| **7** | **PM 重配 competitor_domains**（移除 Bunnings/Reece/Beaumont 等非真竞品）| 10 min | v2 keyword gap 可用 | 🔴 BLOCKING |
| **8** | 上线 4 Campaign（Day 1 配置或复盘）| 5h | 月预算 AU$2,100 / 月 35-70 lead | ⏳ 待 #6 +  落地页 SEO 修好 |
| **9** | 新建 Phase 1 6 篇 blog | 12h FDE 工时 | +220 clicks/月 SEO | ⏳ 待 PM OK |

**合计 30 天 SEO 增益预估**：**+480 clicks/月**（约 +316% 站点流量增长）— 全部来自 SEO 改写，不烧 Ads

**Ads Campaign 月预估**（如果决定上线）：AU$2,100 月花费 / 800-1,400 月点击 / 35-70 月 lead

---

## 四、关键风险 + 红线复述

1. 🔴 **竞品配置错误** — Bunnings/Reece/Beaumont 不是 Oztop 真竞品，必须 PM 重配
2. 🔴 **PM 需告知 Oztop Google Ads 现状** — 决定本轮是 Day 1 配置还是复盘流程
3. 🔴 **Oztop CMS 待确认**（WordPress 还是其他）— 影响落地页改写执行方式
4. 🔴 **conversion tracking 必须装客户域名 oztopbuildingsupplies.com.au** — 不装 ME 域名
5. 🔴 **不卖 shutters / curtains / herringbone / wallpaper** — PM 历史强约束（参见 memory: feedback_no_business_fabrication.md Oztop shutters 事故）
6. 🔴 **不投 Sydney / Melbourne / 其他州** — Oztop business_scope=local QLD-only
7. 🔴 **数字来源必须真实**：所有 KD / Volume / CPC 等 PM 重配竞品后 v2 接入 DataForSEO 回填
8. 🔴 **AU 拼写**：colour / organisation / centre / kilometre — RSA + SEO 文案必须正确
9. ⚠️ **ME 平台 Branded 识别 bug** — Oztop 同样 0% 显示，子牙单独 PR 修复中

---

## 五、附件清单

| 文件 | 内容 |
|---|---|
| `00-research-summary.md` | 本文档（总报告）|
| `01-gsc-signal-buckets.md` | GSC 28 天 5 个信号桶 + 5 transactional 词 + 31 brand 页机会 |
| `02-google-ads-plan.md` | 4 Campaign 结构（B2C / B2B / Brand 防御 / Brand dealer）+ 30+ 关键词 + 4 RSA 模板 + 否定词 |
| `03-page-rewrites.md` | 6 落地页改写 + 31 brand 页批量模板 |
| `04-seo-content-backlog.md` | Phase 1 6 篇 blog backlog + Phase 2 候选 |

**SOP（可复用其他客户）**：`docs/sops/keyword-gap-attack-playbook.md`（已上 PR #453）

---

## 六、PM 下一步（按顺序）

1. 看完本报告 → 逐条 OK / NOT-OK 上述 9 个行动
2. **回答 BLOCKING 问题**：
   - Q1：Oztop Google Ads 现状（上线 / 未上线）？
   - Q2：Oztop 真竞品有哪些？（移除 Bunnings/Reece/Beaumont，加 Brisbane 本地 flooring 供应商）
   - Q3：Oztop 站点 CMS 是 WordPress 还是其他？
3. 决定本轮是否上 4 Campaign → 上 = 我接着出 Day 1 上线 checklist
4. 6 + 31 个落地页改写谁来改？FDE 排期？还是子牙调 Codex 做？
5. 6 篇 Phase 1 blog 让 Claude Code 调李白写（跟 CTS 同模式）？
6. 同步 Airtable Decisions Log（Oztop 项目 base `appwDGVrhmy6OBttC` / table `tblXDoXwWKEG59lQG`）

---

**报告完。等 PM 反馈。**
