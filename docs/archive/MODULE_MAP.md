# Magic Engine — 模块功能映射表

> 🗄️ **已归档 2026-07-25 — 路径已失效。**
> 文中引用的 `src/lib/semrush/` 和 `src/app/api/semrush/` **已不存在**（改名 `keyword-intelligence`，
> 入口是 `src/lib/keywords/resolver.ts`）。现行模块↔代码映射见 [../STATE.md §3](../STATE.md)。


> 本文件是 Magic Engine 四大模块与线上功能、代码路径、ROADMAP Phase 的完整对照。
> 最后更新：2026-05-12
>
> **原则**：每个功能必须归属一个模块。ROADMAP 按技术 Phase 组织，本文件提供模块视角。

---

## 快速导航

- [模块一：SEO](#模块一-seo)
- [模块二：社媒](#模块二-社媒)
- [模块三：广告](#模块三-广告)
- [模块四：数据](#模块四-数据)
- [UI 入口对照](#ui-入口对照)
- [对齐缺口汇总](#对齐缺口汇总)

---

## 模块一：SEO

**封装名**：SEO 内容引擎 | **状态**：✅ 成熟 | **对应 Phase**：Phase 7, 8.A/B/C/D/6/7/8/9

| 功能 | 子模块封装名 | 代码路径 | ROADMAP Phase | 线上状态 |
|------|------------|---------|--------------|---------|
| 关键词概览 / 相关词 / 竞品词 / 缺口分析 | Keyword Intelligence | `src/lib/semrush/` `src/app/api/semrush/` | Phase 8.A | ✅ |
| 域名全量内容采集（DNZ） | Site Analyzer | `src/lib/site-audit/` `src/app/api/clients/[id]/site-audit/` | Phase 8.D | ✅ |
| 内容现状快照 + 页面分类 | Site Analyzer | `src/lib/site-audit/classifier.ts` | Phase 8.D.Stage1 | ✅ |
| 三维内容策略分析 | — | `src/lib/strategy/` `src/app/api/clients/[id]/strategy/` | Phase 8.1 | ✅ |
| 双信号博客生成（SEO×GEO） | Blog Studio | `src/lib/blog/` `src/app/api/clients/[id]/blog/` | Phase 7.3 | ✅ |
| AI 引擎排名追踪（4大AI） | AI Visibility Tracker | `src/lib/ai-tracker/` `src/app/api/ai-tracker/` | Phase 7.1 | ✅ |
| GEO 推荐指令生成 + 注入 | GEO Composer | `src/lib/geo/` `src/app/api/clients/[id]/geo/` | Phase 7.2 | ✅ |
| 外链数据 | Link Intelligence | `src/lib/dataforseo/` | Phase 8.6 | ✅ |
| 关键词排名追踪（SERP） | SERP Intelligence | `src/lib/dataforseo/` | Phase 8.7 | ✅ |
| AU/NZ 本地搜索可见度 | Local Visibility | `src/lib/dataforseo/` | Phase 8.8 | ✅ |
| 行业基准对标 | Market Baseline | `src/lib/semrush/` | Phase 8.9 | ✅ |
| Google AIO 追踪 | — | 未建 | Phase 10.5 | 📋 规划 |

**UI 入口**：`/dashboard/clients/[id]` → SettingsDrawer → Site Audit / SEO Gap 标签
**独立页面**：`/dashboard/clients/[id]/blog` · `/dashboard/clients/[id]/site-audit` · `/dashboard/clients/[id]/strategy` · `/dashboard/clients/[id]/seo-gap`

---

## 模块二：社媒

**封装名**：社媒内容矩阵 | **状态**：✅ 成熟 | **对应 Phase**：Phase 1-6, 8.R, 8.Q, 8.B

| 功能 | 子模块封装名 | 代码路径 | ROADMAP Phase | 线上状态 |
|------|------------|---------|--------------|---------|
| 品牌底稿生成（官网 + PDF + AI精炼） | Brand Brief Studio | `src/lib/brief/` `src/app/api/clients/[id]/brief/` | Phase 3-4 | ✅ |
| 营销活动管理 + 批量内容生成 | Campaign Studio | `src/app/api/clients/[id]/campaign/` | Phase 5 | ✅ |
| 内容工作区（4 Tab：活动/Reels/图片/Marketplace） | ContentHub | `src/app/dashboard/clients/[id]/_components/ContentHub.tsx` | Phase 8.Q（2026-05-12重构） | ✅ |
| AI 图片生成（WaveSpeed Flux-dev） | Visual Studio | `src/lib/visual/wavespeed.ts` | Phase 5-6 | ✅ |
| AI 视频生成（Seedance 2.0） | Video Studio | `src/lib/visual/seedance.ts` | Phase 5-6 | ✅ |
| AI 头像视频（HeyGen） | Avatar Studio | `src/lib/visual/heygen.ts` | Phase 5-6 | ✅ |
| Reels 工作室（提示词+参考帧+I2V） | Video Studio | `src/app/dashboard/clients/[id]/_components/ReelsStudio.tsx` | Phase 8.R | ✅ |
| 多平台排期发布（Publer） | Publishing Hub | `src/lib/publer/` | Phase 6 | ✅ |
| FB Marketplace 内容生成 | — | 未建 | Phase 8.M（待建） | ⏸ 规划 |
| 客户 5 步建档向导 | — | `src/app/dashboard/clients/new/` | Phase 8.3.1 | ✅ |

**UI 入口**：`/dashboard/clients/[id]` → ContentHub（主工作区）
**独立页面**：`/dashboard/visuals`（Visual Studio 全局视图）

---

## 模块三：广告

**封装名**：Ads Intelligence | **状态**：⏸ 暂缓（2026-05-12，待模块1/2完成后启动）| **对应 Phase**：Phase 11（新建）

| 功能 | 子模块封装名 | 代码路径 | ROADMAP Phase | 线上状态 |
|------|------------|---------|--------------|---------|
| Google / Meta / TikTok / LinkedIn OAuth 账户连接 | Ads Intelligence | 未建 | Phase 11 S2/S3 | ❌ 缺失 |
| 广告账户数据拉取（实时 API） | Ads Intelligence | 未建 | Phase 11 S2/S3 | ❌ 缺失 |
| CSV 上传触发诊断（兜底方案） | Ads Intelligence | 未建（Cowork插件已验证） | Phase 11 S1 | ❌ 待迁移 |
| 9维度 AI 诊断引擎 | Ads Intelligence | 未建（Cowork插件已验证） | Phase 11 S1 | ❌ 待迁移 |
| 健康度评分（0–100，NZ市场基准） | Ads Intelligence | 未建 | Phase 11 S1 | ❌ 待迁移 |
| P0/P1/P2 优化建议生成 | Ads Intelligence | 未建 | Phase 11 S1 | ❌ 待迁移 |
| 一键 Fix（暂停词/加否定词/调出价） | Ads Intelligence | 未建 | Phase 11 S3 | ❌ 缺失 |
| Talk to Us 工单流程 | Ads Intelligence | 未建 | Phase 11 S4 | ❌ 缺失 |
| 广告文案批量生成（格式矩阵） | Paid Social Studio | `src/lib/paid-social/`（任务清单已写） | Phase 8.P ⏸ | ⏸ 暂缓 |
| 广告诊断 Word 报告生成 | Ads Intelligence | 已在 Cowork 插件验证 | Phase 11 S1 | ❌ 待迁移 |

**第一测试客户**：Mobilestation（NZ，Google Ads，健康度34/100，Cowork插件已完成验证）
**开发计划**：[ADS_MODULE_BRIEF.md](./ADS_MODULE_BRIEF.md)
**UI 入口**：待建 → `/dashboard/clients/[id]/ads`

---

## 模块四：数据

**封装名**：Insight Reports | **状态**：⏸ 暂缓（2026-05-12，待模块1/2完成后启动）| **对应 Phase**：Phase 9

| 功能 | 子模块封装名 | 代码路径 | ROADMAP Phase | 线上状态 |
|------|------------|---------|--------------|---------|
| 6大数据源月报聚合（SEO+AI排名+社媒+广告） | Insight Reports | `src/lib/reports/` | Phase 8.C.1 | ✅ 框架 |
| 月报 PDF 生成 | Insight Reports | 未建 | Phase 9.1 | 📋 规划 |
| 月报定时邮件发送（Resend） | Insight Reports | 未建 | Phase 9.2 | 📋 规划 |
| 客户 Portal（数据看板 + 内容审批） | Client Portal | 未建 | Phase 9.3 | 📋 规划 |
| 四大模块 KPI 聚合视图 | — | 未建 | 未入 ROADMAP ⚠️ | ❌ 缺失 |
| DataForSEO 成本监控 | Billing Monitor | `src/lib/dataforseo/billing.ts` | Phase 8.11 | ✅ |

**当前状态**：月报数据收集逻辑已建，PDF生成 + Portal + 跨模块聚合视图均未建。
**UI 入口**：待建 → `/dashboard/clients/[id]/reports`

---

## UI 入口对照

> 2026-05-12 重构后的客户详情页结构（`/dashboard/clients/[id]`）

```
客户详情页
├── ContentHub（主工作区）            ← 社媒模块
│   ├── 🎯 推广活动（Campaign Studio）
│   ├── 🎬 Reels（Video Studio）
│   ├── 🖼️ 图片 → 跳转 Visual Studio
│   └── 🛒 Marketplace（占位）
│
├── ⚙️ 设置按钮 → SettingsDrawer     ← SEO模块配置
│   ├── ✨ Master Brief
│   ├── 🔍 Site Audit
│   ├── 📊 SEO Gap → 独立页面
│   └── 👤 客户信息
│
├── 独立子页面（侧边栏导航）
│   ├── /blog         ← SEO 博客生成
│   ├── /site-audit   ← SEO DNZ采集
│   ├── /strategy     ← SEO 内容策略
│   └── /seo-gap      ← SEO 关键词缺口
│
└── ❌ 尚未存在的模块入口
    ├── /ads          ← 广告模块（待建）
    └── /reports      ← 数据模块（待建）
```

---

## 对齐缺口汇总

| 缺口类型 | 描述 | 影响 | 建议操作 |
|---------|------|------|---------|
| **广告模块 UI 入口缺失** | 客户详情页无 Ads 标签/入口 | 功能建好后无处导航 | Phase 11 S1 完成后加入 ContentHub 或独立 Tab |
| **数据模块 UI 入口缺失** | 无月报/Portal 入口 | 数据模块不可见 | Phase 9.1 完成后加 /reports 入口 |
| **广告诊断逻辑未迁移** | Cowork 插件验证通过但未进代码库 | 无法在 ME 内服务客户 | Phase 11 S1 第一优先 |
| **四模块聚合视图未规划** | 数据模块中跨模块 KPI 视图未入 ROADMAP | 数据模块不完整 | 加入 Phase 9 任务清单 |
| **PRODUCT_OVERVIEW 旧愿景** | 原来的"三大能力"愿景句 | 对外沟通不一致 | ✅ 已更新（2026-05-12） |
| **Dashboard 导航未对齐** | 全局侧边栏是 Content/Visuals/Keywords 等技术路径 | 不符合 4 模块用户认知 | Phase 9+ 导航重组 |
