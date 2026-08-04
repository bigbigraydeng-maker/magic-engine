# Magic Engine — 平台架构规划

> 🗄️ **已归档 2026-07-25。**
> §四 / §五 的 MLT 代币与套餐已被 MTC 取代（见 [../specs/PHASE_20_MTC_SPEC.md](../specs/PHASE_20_MTC_SPEC.md)）。
> §一~§三 / §七~§八 的产品定位内容以 [../PRODUCT.md](../PRODUCT.md) 为准。


> 版本：v1.0 — 2026-05-10  
> 定位：Magic Lab 对外 SaaS 平台，面向 AU/NZ 中小企业

---

## 一、产品定位

Magic Engine 是一个**营销智能平台**，不是内容生成工具。  
核心差异化：把 AI 能力 + NZ/AU 市场洞察 + 专业团队判断打包成可订阅的服务。

```
客户看到：干净的数据仪表盘 + 一键生成内容
客户感受：我的营销顾问在帮我监控和运营
背后实际：Magic Engine API + Zhong 团队专业层介入
```

---

## 二、四大模块架构

### Module 1 — SEO（有机搜索 + AI 可见度）

| 层级 | 功能 | 数据来源 | Token 消耗 |
|------|------|---------|-----------|
| 轻量层（免费） | 核心关键词排名趋势 | GSC OAuth | 0 |
| 轻量层（免费） | 自然流量概览 | GA4 OAuth | 0 |
| 轻量层（免费） | AI 可见度分数（计算指标） | 内部计算 | 0 |
| 专业层 | 关键词策略分析报告 | SEMrush API | 60 MLT |
| 专业层 | 竞争对手对比报告 | SEMrush + Claude | 80 MLT |
| 专业层 | SEO+GEO 文章生成 | Claude Sonnet | 20 MLT/篇 |
| 专业层 | GEO 指令包（5条） | Claude Sonnet | 50 MLT |
| 专业层 | AI 可见度深度报告（月度） | 多引擎 + 分析 | 80 MLT |

### Module 2 — Social Media（内容生产 + 排期发布）

| 层级 | 功能 | 数据来源 | Token 消耗 |
|------|------|---------|-----------|
| 轻量层（免费） | 发布日历预览 | Publishing Hub | 0 |
| 轻量层（免费） | 内容表现数据（点赞/触达） | Meta API | 0 |
| 轻量层（免费） | TikTok 帖子表现 | TikTok API | 0 |
| 专业层 | 社媒系列生成（5条/批） | GPT-4o-mini | 15 MLT |
| 专业层 | AI 图片 / 海报（单张） | Flux-dev | 10 MLT |
| 专业层 | 海报套装（12张） | Flux-dev × 12 | 80 MLT |
| 专业层 | Reels 视频（30s） | Seedance 2.0 | 50 MLT |
| 专业层 | 头像视频（60s，Avatar Studio） | HeyGen | 80 MLT |
| 专业层 | Publishing Hub 排期同步配置 | Publer API | 150 MLT（一次性） |

### Module 3 — Ads Management（TikTok / Meta / Google Ads）

| 层级 | 功能 | 数据来源 | Token 消耗 |
|------|------|---------|-----------|
| 轻量层（免费） | 广告花费概览 | Meta Ads API | 0 |
| 轻量层（免费） | CTR / ROAS 基础指标 | Google Ads API | 0 |
| 轻量层（免费） | 各平台汇总卡片 | TikTok Ads API | 0 |
| 专业层 | 广告创意生成（图+文） | Flux + Claude | 30 MLT |
| 专业层 | 受众分析报告 | Meta API + Claude | 60 MLT |
| 专业层 | 投放策略优化建议 | Claude Sonnet | 80 MLT |
| 专业层 | 月度广告复盘报告 | 全源 + Claude | 100 MLT |

### Module 4 — Data Analytics（跨平台数据整合）

| 层级 | 功能 | 数据来源 | Token 消耗 |
|------|------|---------|-----------|
| 轻量层（免费） | 流量来源汇总 | GA4 OAuth | 0 |
| 轻量层（免费） | 转化漏斗概览 | GA4 OAuth | 0 |
| 轻量层（免费） | 跨平台数据合并展示 | 全源合并 | 0 |
| 专业层 | 深度归因分析 | GA4 + Claude | 80 MLT |
| 专业层 | 跨平台策略建议 | 全源 + Claude | 80 MLT |
| 专业层 | 月报自动生成（PDF） | 全源 + Claude | 100 MLT |

---

## 三、数据接入方案 — 推荐方案 C（分阶段混合）

### 方案对比

| | 方案 A（客户 OAuth） | 方案 B（手动录入） | 方案 C（混合）✅ |
|--|---|---|---|
| 数据真实性 | 高 | 中 | 高 |
| 开发成本 | 高 | 低 | 中（分阶段） |
| 可扩展性 | 高 | 低 | 高 |
| 启动速度 | 慢 | 快 | 快→慢→快 |
| 适合阶段 | 成熟期 | 验证期 | 全程适用 |

### 落地路线图

```
Phase 1（现在）：手动 MVP
├── 团队手动录入 CTS 数据
├── 验证界面 + 工作流
└── 0 OAuth 依赖，快速上线

Phase 2（1个月后）：接入 GSC + GA4
├── 最重要的两个数据源
├── Google OAuth 最成熟（文档完善）
└── 覆盖 Module 1 + Module 4 轻量层

Phase 3（3个月后）：接入 Meta + TikTok
├── Meta Business OAuth（Pages + Ads 合并授权）
├── TikTok Business API
└── 覆盖 Module 2 + Module 3 轻量层

Phase 4（6个月后）：全自动
├── 所有轻量层数据自动每日刷新
├── 团队专注于专业层服务
└── 支持 10+ 客户并行
```

### OAuth 接入清单

| 平台 | OAuth 范围 | 覆盖模块 | 优先级 |
|------|-----------|---------|--------|
| Google（GSC） | `webmasters.readonly` | Module 1 | P1 |
| Google（GA4） | `analytics.readonly` | Module 1, 4 | P1 |
| Google Ads | `adwords` | Module 3 | P2 |
| Meta（Pages + Ads） | `pages_read_engagement`, `ads_read` | Module 2, 3 | P2 |
| TikTok Business | `business.read` | Module 2, 3 | P2 |

---

## 四、Token 消耗体系（1 MLT = $0.10 NZD）

### 轻量层
**全部免费**，包含在任意套餐中。客户只要授权数据接入，就能看到基础仪表盘。

### 专业层 Token 汇总

| 类别 | 最低消耗 | 最高消耗 | 典型月消耗（CTS 规模） |
|------|---------|---------|-------------------|
| SEO 专业分析 | 20 MLT | 80 MLT | ~200 MLT |
| 内容生成 | 10 MLT | 150 MLT | ~3,000 MLT |
| 广告分析 | 30 MLT | 100 MLT | ~150 MLT |
| 数据报告 | 80 MLT | 100 MLT | ~200 MLT |
| **月度合计** | | | **~3,550 MLT ≈ $355 NZD** |

> CTS Growth 套餐含 10,000 MLT/月（$1,000 NZD），实际消耗约 3,500 MLT，剩余 6,500 MLT 结转。  
> 这 6,500 MLT 可用于 Academy 课程、一次性项目（网站重建、品牌底稿）等。

---

## 五、月度套餐

| 套餐 | MLT/月 | 月费 NZD | 轻量层 | 专业层 | 适用 |
|------|--------|---------|--------|--------|------|
| Free | 0 | $0 | ✅ 全开放 | ❌ 锁定 | 潜在客户试用 |
| Starter | 2,000 | $200 | ✅ | 有限使用 | 小品牌 |
| Growth | 10,000 | $1,000 | ✅ | 完整使用 | CTS 当前 |
| Scale | 20,000 | $2,000 | ✅ | 高频生产 | 多品牌 |

超额 Token：$0.12 NZD/MLT（比套餐价高 20%）

---

## 六、Academy Token 用法

Magic Lab Academy 课程可用 MLT 支付（等同于现金）：

| 课程 | MLT | NZD 等值 |
|------|-----|---------|
| 入门课程（AI 营销基础） | 500 MLT | $50 |
| 完整计划（3个月） | 2,000 MLT | $200 |
| 精英班（含 1v1 辅导） | 5,000 MLT | $500 |

---

## 七、UI 产品逻辑

### 专业层解锁方式
- 客户看到锁定功能 → 点击"解锁"或"联系我们"
- **自助解锁**：直接消耗 Token，系统自动执行（内容生成、报告生成）
- **团队介入**：发送请求给 Zhong 团队，团队确认后消耗 Token 并交付（策略分析、受众研究）

### 客户端不露出供应商名
| 真实服务 | 客户看到 |
|---------|---------|
| Claude Sonnet | Strategy Engine |
| GPT-4o-mini | Content Engine |
| Flux-dev | Visual Studio |
| Seedance | Video Studio |
| HeyGen | Avatar Studio |
| SEMrush | Keyword Intelligence |
| Publer | Publishing Hub |
| Airtable | Content Workspace |

---

---

## 八、Native vs Third-party 交付矩阵

> 核心策略：**Magic Engine 原生能力 = 内容生产**（文字 + 图片 + 视频 + 报告）。  
> 自助生成功能全面开放，作为**获客渠道**；数据采集 + 广告投放由团队托管交付。

### 8.1 Magic Engine 可直接自助交付（Self-serve — 开放为获客渠道）

| 功能 | 模块 | 技术实现 | 开放策略 |
|------|------|---------|---------|
| SEO + GEO 博客文章生成 | SEO | Claude Sonnet | ✅ 自助，低 MLT，高频体验 |
| 元描述 / H1 批量优化 | SEO | Claude Sonnet | ✅ 自助 |
| GEO 指令包生成（5条）| SEO | Claude Sonnet | ✅ 自助 |
| AI 可见度分数计算 | SEO | 内部计算 | ✅ 免费展示 |
| 社媒帖子批量生成 | Social | GPT-4o-mini | ✅ 自助，极低 MLT |
| AI 图片 / 海报生成 | Social | Atlas Cloud / Flux-dev | ✅ 自助，$1/张 吸引力强 |
| Reels 短视频生成（30s）| Social | Seedance 2.0 | ✅ 自助（高 WOW 感） |
| Avatar 头像视频（60s）| Social | HeyGen | ✅ 自助（高价值演示） |
| 广告文案生成（A/B 多版本）| Ads | Claude Sonnet | ✅ 自助 |
| 广告创意图生成 | Ads | Atlas Cloud | ✅ 自助 |
| 受众 Persona 文档生成 | Ads | Claude Sonnet | ✅ 自助 |
| 月度数据洞察报告（AI 解读）| Analytics | Claude Sonnet | ✅ 自助 |
| PDF 月报自动生成 | Analytics | Claude Sonnet | ✅ 自助 |

### 8.2 依赖第三方 / 需团队介入交付（Managed — 陪跑客户专属）

| 功能 | 模块 | 依赖方 | 交付方式 |
|------|------|--------|---------|
| 关键词策略分析报告 | SEO | SEMrush（Keyword Intelligence）| 团队交付 |
| 竞争对手对比报告 | SEO | SEMrush + Claude | 团队交付 |
| 关键词排名数据展示 | SEO | GSC OAuth（Phase 2 接入）| 轻量层免费展示 |
| 跨平台内容排期发布 | Social | Publer API（Publishing Hub）| 团队配置，客户操作 |
| 社媒内容表现数据 | Social | Meta API / TikTok API | 轻量层免费展示 |
| Meta / Google 广告投放 | Ads | Meta Ads / Google Ads 平台 | 团队操作，平台执行 |
| TikTok 广告投放 | Ads | TikTok Ads API | 团队操作 |
| 广告花费 / CTR / ROAS 展示 | Ads | Meta/Google/TikTok Ads API | 轻量层免费展示（Phase 3 接入）|
| 跨平台自动化工作流 | All | Markifact | 团队配置，作为平台运营基础设施 |
| GA4 流量 / 转化分析 | Analytics | GA4 OAuth | 轻量层免费展示（Phase 2 接入）|
| 深度归因分析 | Analytics | GA4 + Claude | 团队解读 + 报告交付 |

### 8.3 内容飞轮逻辑

```
Magic Engine 生成内容（原生）
    ↓
Publishing Hub 排期发布（Publer，团队配置）
    ↓
Meta / TikTok / Google 收集用户行为数据（平台原生）
    ↓
GA4 + GSC 汇总流量数据（OAuth 接入）
    ↓
Claude 解读数据 → 生成洞察报告（原生）
    ↓
AI Tracker 弱项 × SEMrush 低 KD 机会 → 下一批内容选题
    ↓
回到第一步（闭环）
```

### 8.4 产品策略总结

- **ME 原生能力（内容生产）= 获客 + 留客引擎**：图片/视频/文章生成体验好，让客户主动使用，降低获客成本
- **数据采集 = 免费轻量层**：OAuth 接入后自动展示，体现平台价值，不消耗 MLT
- **广告投放 = 高利润托管服务**：ME 只出创意素材，实际投放由团队操作，收策略层 Token
- **SEMrush / Markifact = 平台基础设施**：成本计入套餐运营费用，不单独向客户拆账

---

*文档关联：[BILLING_TOKEN_SYSTEM.md](./BILLING_TOKEN_SYSTEM.md) · [ROADMAP.md](./ROADMAP.md)*
