# CTS · 月预算调整 NZ$3,000（Google + Meta 双平台）

> **更新时间**：2026-06-11 NZST
> **PM 拍板**：CTS 月广告预算从 NZ$900 (v1/v2) 升到 **NZ$3,000**，分配 Google + Meta 两平台
> **Google / Meta 具体比例**：晚些讨论
> **替代**：本文档是 `02-google-ads-plan.md` § 8/9 + `05-v2-update-from-me-screenshots.md` § 8 的预算块**增量更新**

---

## 一、预算从 NZ$900 → NZ$3,000 (×3.3) 的影响

### 1.1 · Campaign 容量上调（按 ×3.3 重算）

| 指标 | v2 (NZ$900) | v3 (NZ$3,000) | 增长倍数 |
|---|---:|---:|---:|
| 月 Ads 总花费 | NZ$900 | NZ$3,000 | 3.3× |
| 月预估点击 | 500-800 | **1,650-2,640** | 3.3× |
| 月预估展示 | 12,000-20,000 | **40,000-66,000** | 3.3× |
| 月转化（询盘）| 15-30 | **50-100** | 3.3× |
| CPA（单次询盘）| NZ$36-75 | NZ$36-75 | 不变 |
| 月成单（按 5-10% 转化率）| 1-3 团 | **3-10 团** | 3.3× |
| 月毛利估算 | NZ$300-1,500 | **NZ$900-15,000** | 3-10× |

⚠️ **CPA 上限保持 NZ$75**（不能因为预算大就乱花，超过这个 CPA 就要回头优化关键词 / 落地页）

⚠️ **Smart Bidding 学习期**：预算翻倍后 Smart Bidding 重新进入 7-14 天学习期，**前 2 周转化数据会不稳定**。坚持 14 天不调出价 / 不停 keyword。

---

## 二、Google + Meta 双平台分配框架（待 PM 拍板）

### 2.1 · 三种分配方案给 PM 参考

#### **方案 A · Google 主力（70/30）**：Google NZ$2,100 + Meta NZ$900

- **适用**：高 intent 用户（"china tours from nz" 直接搜索的人）转化率最高
- **优势**：Google 搜索流量决策周期短 + 询盘转化率高
- **劣势**：Meta 兴趣发现 / 远程营销弱
- **建议**：CTS 当前 Day 1 阶段 + master_brief.target_audience.platforms 包含 "google search" — 推荐这个

#### **方案 B · Meta 主力（30/70）**：Google NZ$900 + Meta NZ$2,100

- **适用**：品牌曝光 + 兴趣阶段抓单
- **优势**：Meta 视频 / 图片广告对 35-70 岁 Kiwi 文化游有视觉吸引力
- **劣势**：Meta 转化路径长，3-6 个月才能看到稳定 lead
- **建议**：CTS 已有 Meta 投放经验 + 现有创意素材（Reels） → 可考虑

#### **方案 C · 平均分（50/50）**：Google NZ$1,500 + Meta NZ$1,500

- **适用**：两平台都重要不偏废
- **劣势**：每个平台预算都不够大 → 学习期慢

### 2.2 · 我的建议（诸葛亮）

**前 30 天用方案 A**（Google 70 / Meta 30），理由：

1. **Google Ads Day 1 还在学习期** — 让 Google 主流量入口先跑稳，转化数据足够 Smart Bidding 学习
2. **CTS 当前 Conversion tracking 没修好** — 6/10 那天 9 click 0 转化。Meta CAPI 还没接 → Meta 这边数据更差。先把 Google 一条线跑通
3. **Meta 已有现有自然投放 + 创意 ROI** — 不需要急着加大付费 Meta（参见 ROADMAP Phase 18.D Meta Creative Testing Flywheel 还在登记中）
4. **30 天后回查**：如果 Google CPA 稳定在 NZ$50- → Meta 可加大到 50/50。如果 Google 烧不动 → 全转 Meta

**最终决定权在 PM**。

---

## 三、Campaign 结构调整

### 3.1 · Google Ads Campaign 重新设计（NZ$2,100/月 方案下）

**v2 结构**（v3 改）：

```
[Google Ads Account] 105-817-1329 China Travel

  ┌─ Campaign 1 (existing): CTS — Three Tours + Brand Defense — Search
  │     [品牌防御]
  │     daily NZ$15 / Maximize clicks / 修过 3 件事
  │     月预算 NZ$450
  │
  ├─ Campaign 2 (v2 new): CTS — China Tours Industry — Search
  │     [行业获客 — 升级版]
  │     daily NZ$40 (vs v2 NZ$30) / Maximize clicks → Day 15 tCPA
  │     月预算 NZ$1,200
  │     ├─ AG_HighIntent     ~NZ$22  (20 关键词)
  │     ├─ AG_BestOfChina    ~NZ$13  (22 关键词)
  │     └─ AG_LongTail       ~NZ$5   (8 关键词)
  │
  └─ Campaign 3 (v3 NEW): CTS — Display Remarketing
        [Remarketing — Google Display Network]
        daily NZ$15 / Maximize clicks
        月预算 NZ$450
        Audience: 90 天访问过 ctstours.co.nz 的 Kiwi
        定向: visa-free 页 / china tour 页访问过的人
```

**Total Google = NZ$2,100**

#### Campaign 3 (Display Remarketing) 是 v3 新增

**为什么加**：CTS 站点 28 天 GSC 已经接到 6,961 visa-free 曝光，但只转化 34 click — 大量"研究阶段"用户进站离开。**用 Display Remarketing 7 天后追回他们**。

**配置要点**：
- Audience: Google Ads → Audiences → 建 "ctstours.co.nz visitors last 90 days"（需要 GA4 connector ✅ 已接，跑 24h 后人群可用）
- Ad creative: 静态 banner + 短视频 mix
- Final URL: `/tours/china/discovery/essentials`（Best of China 团页）
- 预估 CPA: NZ$25-40（remarketing 转化率通常是 cold 的 2x）

### 3.2 · Meta Ads Campaign（NZ$900/月 方案下）

**当前 Meta 状态**（推断，需要 PM 验证 ROADMAP / memory）：
- Phase 18.A Meta Ads MVP 已完成
- 已有创意素材（OZTOP REELS 同期做的，CTS 应该也有）

**v3 Meta 调整**：
- 现有 organic Reels 投放保留
- 新增 1 个付费 Meta Conversions Campaign:
  - **Daily**: NZ$30
  - **Optimization**: Lead (Meta CAPI 必须先接好，否则学不到)
  - **Audience**: NZ 35-70 + Interests "cultural travel" "Asia tours" "Beijing" "Shanghai"
  - **Creative**: 用现有 Reels + 1 个新静态 carousel "10 Reasons Kiwis Love CTS"
  - **Landing**: `/china-tours-from-new-zealand`

---

## 四、Conversion Tracking 强约束（同样适用 NZ$3,000 版）

跟 NZ$900 版本一样的硬要求：

1. 🔴 Google Ads 4 个 Conversion Action 必须先建（虽然 CTS 只用 1 个 primary contact form）
2. 🔴 gtag/GTM 必须装 ctstours.co.nz，**绝禁 magicengine.com.au 子路径**
3. 🔴 thank-you 页必须存在 + form 必须 redirect 到 thank-you（CTS 站点 sitemap 显示已有 /thank-you ✅）
4. 🔴 **Meta Conversions API 必须接**（Pixel + CAPI 双源 + dedup）— Oztop 那份 `01-conversion-tracking-sop.md` Step 5 通用，CTS 套用同模式

---

## 五、月度复盘节奏（NZ$3,000 版的强化）

预算 ×3.3 = 责任 ×3.3。**每月 1 日 PM + 诸葛亮 + 板桥 合议**：

| 时间 | 复盘内容 |
|---|---|
| 月初 1 日 | 上月：花费 / CPA / CTR / Conversion / Quality Score 趋势 |
| | 上月：Top 10 Search terms（防 Broad match 杂质） |
| | 上月：哪个 Ad Group / Keyword 表现差 → 暂停 |
| | 上月：哪个新词应该加（从 Search terms report 拓词） |
| | 本月：Google / Meta 分配调整？ |
| | 本月：是否升级 Smart Bidding（tCPA vs Maximize conversions vs Maximize conversion value）|
| 月底 | 跑 ME 后台 keyword gap + 落地页 ROI 复查 → 进 SOP 下一轮 |

---

## 六、Airtable Decisions Log 已更新

CTS Decisions Log record `rec2thylEqruw8QoL` 已更新：
- Result 字段加 "v3 预算上调 NZ$3,000 (Google + Meta)"
- Status 保持 In Progress

---

## 七、PM 下一步

按顺序：

1. ✅ **确认本预算调整**（NZ$900 → NZ$3,000）
2. 🔴 **决定 Google / Meta 比例**（A 70/30 / B 30/70 / C 50/50 / 别的）
3. 🔴 **CTS Conversion tracking 必修**（同 Oztop 01-conversion-tracking-sop.md 同流程跑一遍 CTS）
4. ⏳ **CTS 落地页改造** 仍按 v2 5 页改写顺序（Oztop 上产后再动）
5. ⏳ **Campaign 3 Display Remarketing** 上线前提：GA4 90 天 audience 数据已积累
6. ⏳ **Meta CAPI** 接入 ctstours.co.nz（套用 Oztop SOP）

---

## 八、风险声明

⚠️ **预算 ×3.3 不等于 lead ×3.3**。Google Ads 边际成本递增（最便宜的关键词位置 1-3 先填满，后续要进位置 4-10 = CPC 上升 50%+）。

**真实预期**：
- 月点击 ×3-3.3（基本线性，因为关键词池足够大）
- 月询盘 ×2.5-3（Smart Bidding 优化中，质量分整体上升）
- 月成单 ×2.5-4（看落地页 conversion rate 是否同步提升）

如果 30 天后单月成单数 < 3 团 → 不是预算问题，是**落地页 + Conversion + 关键词选择**有问题，回头查 SOP。

---

**v3 报告完。等 PM 拍板 Google/Meta 比例。**
