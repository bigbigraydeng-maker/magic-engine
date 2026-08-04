# Magic Engine — 产品总览

> Magic Lab 旗下核心产品 · 2026 主力收入引擎
>
> ⚠️ **产品视角文档，写于 2026-05-23。系统当前状态请看 [STATE.md](./STATE.md)，未完成任务看 [ROADMAP.md](./ROADMAP.md)。**
>
> 已知过时点：§七「当前阶段」停在 2026-04；定位一节的「三大核心能力」已被 DAPE 四段 + 6 支柱取代（见 [DECISIONS.md](./DECISIONS.md) 2026-06-08）；MLT 代币体系已被 MTC 取代。

---

## 一、战略定位

**Magic Engine 是 Magic Lab 在 2026 年的旗舰产品**，承担两个角色：

1. **直接收入来源**：以**年度陪跑服务**形式向品牌方/代理公司交付，单客户年服务费 5–15 万人民币区间。
2. **Magic Lab Academy 的实战载体**：所有培训案例、SOP、最佳实践都从 Magic Engine 实战中沉淀，反哺培训和咨询服务。

**与传统 SaaS 的差异**：
- ❌ 不卖月费订阅，不做自助注册流程
- ❌ 不依赖单纯软件功能售卖
- ✅ 以"AI 内容资产年度建设"作为交付物
- ✅ Magic Lab 团队作为客户的外部 AI 内容运营部

---

## 二、产品愿景一句话

> **让品牌在搜索、AI、社媒、广告四个战场同时被看见。**

覆盖营销全链路的 AI 运营操作系统：SEO × GEO × 社媒内容 × 广告智能。

### 目标市场（2026）

**主战场：澳大利亚（AU） + 新西兰（NZ）**

- 服务对象：AU/NZ 本地企业商家（旅游、教育、专业服务、本地零售等）
- 内容语言：英文为主，必要时支持中英双语（华人市场）
- 关键词数据库：默认 `au` / `nz`
- AI 引擎追踪：所有问句必须带本地化标签（"in New Zealand"、"for Australian travelers"）
- 地域信号：GEO 指令、博客元数据、社媒帖子均显式声明 AU/NZ 市场定位

这一定位决定了所有内容策略：本地搜索意图优先于全球意图，本地竞品分析优先于全球竞品。

---

## 三、四大模块

> 模块是 Magic Engine 的产品组织单位，每个模块对应一个营销战场，对外封装独立品牌名。

### 模块一：SEO ✅ 成熟
**对外封装名：SEO 内容引擎**

覆盖传统搜索（Google）和新一代 AI 搜索（GEO）的双轨可见度建设。

- **Keyword Intelligence**：关键词雷达（有机词排名追踪 + 竞品缺口分析），全自动跑，无手工工作台
- **Site Analyzer**：客户域名全量采集（DNZ）→ 内容现状快照
- **Blog Studio**：双信号博客（SEO 关键词 + GEO 隐藏指令 同时优化）
- **AI Visibility Tracker** ⭐：4 大 AI 引擎（ChatGPT / Claude / Perplexity / Google AIO）品牌排名周度追踪
- **GEO Composer** ⭐：基于 Tracker 弱项生成 AI 推荐指令，注入网站和博客
- **SEO 数据中台**：外链 / SERP 排名 / 本地搜索 / 市场基准（DataForSEO + SEMrush）

### 模块二：社媒 ✅ 成熟
**对外封装名：社媒内容矩阵**

多平台、多客户、批量化的社媒内容生产线。

- **Brand Brief Studio**：品牌底稿生成与精炼（官网抓取 + PDF + AI对话精炼）
- **Campaign Studio**：营销活动批量内容生成（Route A 关键词 / Route C 自由话题）
- **ContentHub**：推广活动 / Reels / 图片 / Marketplace 四大内容类型统一工作区
- **Visual Studio**：AI 图片生成（WaveSpeed Flux-dev）
- **Video Studio**：AI 视频生成（Seedance 2.0）
- **Avatar Studio**：AI 头像视频（HeyGen）
- **Publishing Hub**：多平台排期发布（Publer）

### 模块三：广告 🔄 建设中（Meta 广告数据已接入，Google Ads 申请中）
**对外封装名：Ads Intelligence**

多平台广告账户连接、AI 诊断引擎、有界自动化 Fix。

- **账户连接**：OAuth 接入 Google / Meta / TikTok / LinkedIn 广告账户
- **诊断引擎**：9 维度 AI 诊断（健康度 0–100 / P0/P1/P2 优化建议）
- **一键 Fix**：可逆 API 操作自动执行（暂停关键词 / 添加否定词 / 调整出价）
- **Talk to Us**：复杂问题标准化交接工单（结构 → 预算 → 创意方向）
- **Paid Social Studio**：品牌底稿 → 批量广告文案 + 配图提示词生成

> 第一个测试客户：Mobilestation（NZ，Google Ads，健康度 34/100）  
> 详细开发计划见 [docs/specs/ADS_MODULE_BRIEF.md](./specs/ADS_MODULE_BRIEF.md)

### 模块四：数据 📋 规划中
**对外封装名：Insight Reports**

跨模块数据聚合，形成可交付给客户的月度智能报告。

- **月报 PDF 自动生成**：SEO + AI 排名 + 社媒 + 广告 六大数据源聚合，Strategy Engine 生成摘要
- **月报定时发送**：Resend 邮件 / 客户 Portal 推送
- **客户 Portal**：客户自助查看数据看板、内容进度、历史报告
- **跨模块聚合视图**：四大模块 KPI 一屏汇总（当前仅内部可见）

---

## 四、用户使用路径（陪跑团队视角）

借鉴 SEO 主流工具的简洁流程，重新设计为 Magic Lab 陪跑场景：

### Step 1 · 客户接入（Onboarding）
**目标**：5 分钟内完成新客户基础档案建立。

```
输入：客户官网 URL + 行业 + 目标受众标签
       ↓
系统自动：
  ① 抓取官网核心页面 → 提取品牌核心主张、产品/服务、痛点、解决方案
  ② 拉取该域名的关键词数据（量、难度、竞品）
  ③ 评估当前 SEO 健康度 + AI 可见度基线
       ↓
输出：客户品牌底稿 v1（可编辑）
```

### Step 2 · 战略对齐（Brief Refinement）
**目标**：陪跑团队与客户对齐方向，形成可执行的内容策略。

- 品牌底稿编辑器：内容支柱、品牌声调、目标受众、视觉风格
- AI 对话精炼：用自然语言修改底稿（"语气更年轻"、"加一个支柱"）
- 关键词库勾选：从扫描结果中确定主攻方向
- 启用底稿 → 后续所有内容生成都自动注入

### Step 3 · 内容规划（Content Planning）
**目标**：基于战略生成可执行的内容日历。

- **博客内容日历**（SEO 视角）：标题 + 关键词 + SEO 难度 + 排期
- **社媒内容日历**（社交视角）：营销活动 → 批量生成 N 篇帖子
- **AI 可见度计划**（GEO 视角）：基于 Tracker 诊断生成针对性内容

### Step 4 · 内容生产（Content Production）
**目标**：把规划落地成可发布的成品。

- 长文博客：标题 + 元数据 + 正文 + 配图 + 内链 + GEO 隐藏指令
- 社媒帖子：文案 + 视觉 + 标签 + 发布时间
- 内容审查面板：双模式重生（"重写文字"/"重生图片"分离）+ SEO 完整性检查清单

### Step 5 · 发布与追踪（Launch & Track）
**目标**：把内容推向各渠道，并持续优化。

- 一键发布到客户社媒账号矩阵
- 博客内容部署到客户网站（含 GEO 隐藏指令）
- AI 可见度每周自动追踪
- 月度报告自动生成（陪跑交付物）

---

## 五、功能子模块对照表

所有子模块对外统一封装命名，**对客户和 UI 不暴露具体技术供应商**：

| 所属模块 | 子模块封装名 | 功能定位 | 状态 |
|---------|------------|---------|------|
| **SEO** | Keyword Intelligence | 关键词数据中枢（DataForSEO；周快照 + 缺口分析，无手工工作台） | ✅ |
| **SEO** | Site Analyzer | 域名全量内容采集（DNZ） | ✅ |
| **SEO** | AI Visibility Tracker ⭐ | 4大AI引擎品牌排名追踪 | ✅ |
| **SEO** | GEO Composer ⭐ | AI 推荐指令生成与注入 | ✅ |
| **SEO** | Blog Studio | 双信号博客生成（SEO×GEO） | ✅ |
| **社媒** | Brand Brief Studio | 品牌底稿生成与精炼 | ✅ |
| **社媒** | Campaign Studio | 营销活动批量内容生成 | ✅ |
| **社媒** | ContentHub | 内容工作区（活动/Reels/图片/Marketplace） | ✅ |
| **社媒** | Visual Studio | AI 图片生成工坊 | ✅ |
| **社媒** | Video Studio | AI 视频生成工坊 | ✅ |
| **社媒** | Avatar Studio | AI 头像视频生成 | ✅ |
| **社媒** | Publishing Hub | 多平台排期发布 | ✅ |
| **广告** | Ads Intelligence | 账户连接 + AI 诊断 + Fix | 🔄 建设中（Meta 已接入） |
| **广告** | Paid Social Studio | 广告文案批量生成矩阵 | ⏸ 暂缓 |
| **数据** | Insight Reports | 月报 PDF 生成（框架已有） | 🔄 部分 |
| **数据** | Client Portal | 客户自助数据看板 | 📋 规划 |

⭐ = 核心差异化功能

---

## 六、商业模式

### 主要收入：年度陪跑服务

```
基础版陪跑（5–8 万/年）
├── 1 个品牌客户
├── 月度 AI 可见度报告
├── 季度 SEO + GEO 战略复盘
├── 月产 8–12 篇博客 + 30–60 条社媒内容
└── 内容审批与发布管道

高级版陪跑（10–15 万/年）
├── 1 个品牌客户（多平台/多语言）
├── 周度 AI 可见度追踪
├── 月度战略会
├── 月产 16–24 篇博客 + 60–120 条社媒内容
├── 视频内容（AI 生成 + 头像视频）
└── 客户网站 GEO 注入 + 持续优化
```

### 衍生收入：Magic Lab Academy

```
培训课程（基于 Magic Engine 实战 SOP）
├── 内容运营总监课程
├── AI 可见度优化（GEO）专项课程
└── 企业内训定制

工具授权（远期）
└── 部分模块以 SaaS 形式向中小企业开放
```

---

## 七、当前阶段（2026-04）

✅ **已具备**：社媒内容矩阵能力完整（多客户、品牌底稿、批量生成、图片/视频生成、内容协作、多平台发布）

🔄 **2026 Q2 重点建设**：
- ⭐ **AI Visibility Tracker** — 多 AI 引擎排名追踪
- ⭐ **GEO Composer** — AI 推荐指令生成与注入
- 长文博客生成线（SEO 视角的内容日历）
- 客户接入向导（5 分钟新客户建档）

📋 **2026 H2 规划**：
- 客户月度报告自动化
- 站点权威度追踪
- 多语言内容支持
- Magic Lab Academy 课程化沉淀

详见 [`ROADMAP.md`](./ROADMAP.md)。

---

## 八、文档导航

| 文档 | 受众 | 内容 |
|------|------|------|
| [`PRODUCT.md`](./PRODUCT.md) | 全员 | 产品愿景、定位、能力体系（本文件） |
| [`ROADMAP.md`](./ROADMAP.md) | 项目管理 | 阶段路线图与任务跟踪 |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | 开发团队 | 技术架构、数据模型、API |
| [`CLAUDE.md`](../CLAUDE.md) | AI 助手 | 项目工作指南与代号映射 |

---

*Magic Lab — 让 AI 真正服务于业务增长。*

---

## 九、Phase 12 执行自动化飞轮（2026-05 建设）

> 核心护城河：Magic Engine 不只是内容生产工具，更是**执行-归因-飞轮**闭环平台。

### 飞轮架构

诊断发现问题 → 自动生成执行动作 → 结果指标快照 → 归因计算 → 飞轮迭代。

四个飞轮方向：
- **SEO 飞轮**：关键词排名追踪 → 博客生成 → 外链/内链优化
- **GEO 飞轮**：AI 可见度追踪 → GEO 指令生成 → 指令注入 → 下次追踪对比
- **社媒飞轮**：发布数据回流 → 内容策略调整 → 下一批 Campaign
- **广告飞轮**：Meta 广告诊断 → 自动 Fix（暂停/调价）→ 效果归因

### 已完成里程碑（Phase 12.I，2026-05-23）

| 功能 | 描述 |
|------|------|
| SEO Intelligence | Position Changes 追踪、Intent 优先内容策略、每周关键词快照 Cron |
| 自主行动泳道 | 执行看板新增「飞轮自主行动」泳道，记录平台自动执行的动作 |
| 一键生成博客 | 从 SEO Intelligence 缺口直接触发博客生成 |
| GEO Composer | 博客头图 HTML 注入（P12.J.1）、Campaign 视觉方向（P12.K.1）|
| 归因 Cron | 每 6 小时计算 baseline→after→verdict |

### 试点客户

- **CTS Tours**：GEO + SEO + Ads（Meta 广告真实数据已接入）
- **Oztop**：SEO + GEO
