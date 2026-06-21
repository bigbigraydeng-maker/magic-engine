# Oztop Meta Ads 优化计划 — 2026-06-18 起

**版本**：v1.0  
**起草**：子牙  
**适用期**：2026-06-18 至 2026-07-31（Walnut 清仓活动截止）  
**对标基准**：Google Ads CPA $46.2 / CTR 4.8%（2026-06 月报）  
**目标**：Meta CPA ≤ $40，Free Measure & Quote Lead 表单提交

---

## 0. 当前状态快照

| 维度 | 现状 |
|---|---|
| 已上线 Campaign | Campaign A — 猛禽系列 · Free Measure · $10/天（Raptor-01 · Video-A，审核中） |
| Pixel | 1. Brisbane/Gold Coast（ID: 1320907320075995）✅ 已安装，Lead 事件追踪中 |
| 广告账户 | Oztop Building Supplies Pty Ltd 独立企业账户 ✅ |
| ME 数据同步 | Airtable Meta Ads Daily 自动同步（cron 每日 3am UTC）✅ 已上线 |
| 待配置 | Campaign B（Walnut 清仓）、Campaign C（Before/After）、第二支猛禽视频 |

---

## 1. 受众策略

### 1.1 核心受众（Cold）

| 受众层 | 设置 | 说明 |
|---|---|---|
| 地理 | Brisbane + 51km, Gold Coast | 覆盖大布里斯班 + GC 装修主力圈 |
| 年龄 | 30–60 岁 | 房产购买 / 装修决策主力年龄段 |
| 兴趣定向 | Home Improvement · Home Renovation · Interior Design · Real Estate · Construction | 多层叠加，Meta AI 自选宽度 |
| 排除 | 竞品品牌受众（Carpet One, Choices Flooring 等） | 防止浪费在品牌忠诚用户 |

**注意**：版位设置全部关闭「进阶赋能型版位（Advantage+）」，手动选 **Facebook 动态 + Reels only**。

### 1.2 再营销受众（Warm）— 预计 Campaign A 跑 2 周后启动

| 受众 | 来源 | 窗口期 |
|---|---|---|
| 网站访问者 | Pixel 追踪 oztopbuildingsupplies.com.au | 90 天 |
| 页面深度访问 | 浏览 /flooring/ 或 /contact/ 但未提交表单 | 30 天 |
| 视频观看 | 观看猛禽视频 ≥ 50% | Campaign A 运行后 |

**触达策略**：再营销受众出价可高出冷受众 30%（更高转化意图），文案强调「免费上门，不买也没关系」。

### 1.3 类似受众（LAL）— Campaign A 积累 50+ leads 后启动

- **种子人群**：即时表单已提交 Lead（从 Meta 后台导出）
- **LAL 比例**：1%（精准）+ 3%（扩量）双组并跑
- **优先市场**：Brisbane DMA，不跨州

---

## 2. 广告创意方向 — 3 套 A/B 测试

### 套 A：产品展示（价格锚点）— Campaign C（待建）

**形式**：图片轮播（3–5 张）  
**内容**：
- 封面：SPC 地板特写 + 「Save $6–$10/m²」大字
- 卡片 1：SPC Vinyl 特写 + 价格从 $XX/m²
- 卡片 2：Hybrid Flooring 特写 + 价格
- 卡片 3：Timber/Engineered 特写 + 价格
- 末卡：「Free Measure & Quote — Ends 31 July」CTA

**文案主轴**：价格+稀缺性（July offer, limited stock）  
**CTA**：了解详情 → 即时表单  
**预期用途**：产品意识阶段，CTR 目标 > 1.5%

---

### 套 B：工程案例（Before/After）— Campaign C（待建）

**形式**：竖版视频（10–15s）或图片轮播  
**内容结构**：
```
[0–3s] Before：老旧地板特写（带音效/文字「Your floors today?」）
[3–8s] After：铺装完成后的空间感照片（明亮/宽敞）
[8–12s] 产品名 + 「Free Measure & Quote」
[12–15s] Logo + 电话 + 表单按钮
```
**文案主轴**：情感共鸣（室内空间焕新感）  
**受众匹配**：再营销层（已看过 A 套的人）  
**CTA**：立即申请 → 即时表单

---

### 套 C：限时活动（清仓 + 免费测量）— Campaign A 已上线

**形式**：竖版视频（猛禽系列）  
**当前状态**：Raptor-01 · Video-A 已发布，审核中  
**7 月优惠文案**（已定稿）：
- Save $6/m² on supply only
- Save $10/m² on supply + install
- All trims included (excl. scotia)
- Ends 31 July 2026

**待完成**：
- [ ] Raptor-02 广告组（第二支视频）
- [ ] 版位改手动：Feed + Reels only
- [ ] 信用卡更新（Ads Manager 警告）

---

## 3. 出价策略

### 3.1 预算分配

| 阶段 | 日期 | 总预算/天 | 分配 |
|---|---|---|---|
| **测试期** | 06-18 ~ 07-01 | **$30/天** | Campaign A: $20 / Campaign B(Walnut): $10 |
| **优化期** | 07-01 ~ 07-15 | **$50/天** | 按 CPA 表现实时调整，砍 CPA > $50 的组 |
| **冲刺期** | 07-15 ~ 07-31 | **$80/天** | 活动截止前 2 周全力投产，预算加到表现最好的组 |

### 3.2 出价逻辑

- **成效目标**：潜在客户数最大化（Lead Gen，已设置）
- **目标 CPA**：≤ $40（低于 Google Ads 基准 $46.2）
- **3 天杀手法则**（强制执行）：
  - CTR < 0.8% 且运行 > 3 天 → 立即暂停该广告
  - CTR > 1.5% + CPA < $30 → 预算翻倍
  - CTR 0.8%–1.5% → 维持观察，调整文案
- **扩量触发点**：当某广告组连续 3 天 CPA < $35 → 日预算 ×1.5

### 3.3 版位出价差异化

| 版位 | 预期 CPM | 策略 |
|---|---|---|
| Facebook Reels | 低 | 优先投放（猛禽竖版视频天然适配） |
| Facebook 动态 | 中 | 图片轮播套（套 A/B） |
| Instagram | 本期不投 | Oztop IG 账号粉丝基础弱，暂缓 |

---

## 4. 追踪闭环

### 4.1 Pixel 状态确认 ✅

| 检查项 | 状态 |
|---|---|
| Pixel 已安装 | ✅ GTM 部署，ID: 1320907320075995 |
| PageView 事件 | ✅ 正常触发 |
| Lead 事件 | ✅ 28 天内 44 次（来自旧 contact 表单） |
| 即时表单 Lead 回传 | ✅ 本次 Campaign A 表单已连接 Pixel（选 Brisbane/Gold Coast 数据集）|

### 4.2 Lead 数据流

```
用户提交即时表单
    ↓
Meta 自动触发 Lead 事件 → Pixel 1320907320075995
    ↓
ME cron (每日 3am UTC) 拉取 Meta Ads 数据
    ↓
写入 meta_ads_snapshots（Supabase）
    ↓
MetaAdsAdapter.pullMetrics() → flywheel_metrics（ads.meta.*）
    ↓
Airtable Meta Ads Daily 自动追加一行
```

### 4.3 ME 执行看板登记（待 META_SYSTEM_USER_TOKEN 配置完成）

**Action 登记计划**（登记到 fb_paid 飞轮）：

| Action | 类型 | 触发条件 |
|---|---|---|
| Campaign A 上线 — 猛禽 Free Measure | `ads.meta.campaign_launch` | 审核通过即登记 |
| Campaign B 上线 — Walnut 清仓 | `ads.meta.campaign_launch` | Walnut LP 表单配置完成后 |
| 3 天杀手检查 — Raptor-01 | `ads.meta.creative_kill` | 06-21 检查 CTR |
| 预算扩量 — CPA < $35 触发 | `ads.meta.budget_scale` | 达标即登记 |

---

## 5. 本期 Campaign 路线图

```
Week 1（06-18 ~ 06-24）
├── Campaign A 审核通过 → 开始跑
├── 修版位：手动 Feed + Reels
├── 更新信用卡
├── 建 Raptor-02 广告组（第二支视频）
└── Campaign B（Walnut 清仓）开始配置表单 + 创意

Week 2（06-25 ~ 07-01）
├── Campaign A 3 天数据复盘（CTR / CPL 判断）
├── Campaign B 上线（Walnut 即时表单 + 清仓文案）
├── 建 Campaign C（Before/After 图片轮播）
└── 数据看板：Airtable 自动更新核查

Week 3–4（07-01 ~ 07-15）
├── 再营销受众启动（基于 Pixel 90 天数据）
├── 按 CPA 表现动态调整预算
└── LAL 受众试投（需要 ≥ 50 条 Lead）

Week 5–6（07-15 ~ 07-31）冲刺
├── 活动最后 2 周加大预算（赶 31 July 截止）
├── 紧急创意替换（如有疲劳迹象）
└── 月底复盘 + 8 月计划起草
```

---

## 6. 立即行动项（今天）

| # | 事项 | 负责 |
|---|---|---|
| 1 | 更新 Oztop Ads Manager 信用卡 | PM |
| 2 | Campaign A 版位改手动（Feed + Reels） | PM |
| 3 | 建 Raptor-02 广告组 + 上传第二支视频 | PM |
| 4 | Render 设 4 个 Airtable env var | PM |
| 5 | Walnut LP 联系表单配置完成 | PM（联系 Oztop 前台） |
| 6 | 在 ME Supabase 更新 CTS meta_ad_account_id | PM（Supabase Studio SQL）|
