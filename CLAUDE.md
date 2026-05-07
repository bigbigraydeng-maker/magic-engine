# Magic Engine — Agent 工作指南

---

## 🚀 每次打开新会话，先看这两个地方

### 第一步：看本文件底部 §十五 → **"B. 当前焦点"表格**
> 告诉你：现在在做什么、下一步是什么。30秒定位完毕。

### 第二步（可选）：打开 ROADMAP.md 顶部 `当前进度速览` block
> 告诉你：所有 Phase 的完成状态。需要上下文时再看。

**不需要记住任何细节。只需要记住：打开 §十五 → B 当前焦点。**

---

## 输出语言

**所有对话和说明必须用中文输出。代码文件内容保持英文。**

---

## 一、项目战略定位（必读）

**Magic Engine（代码库 `magic-engine`）是 Magic Lab 2026 年的旗舰产品**，承担两个角色：

1. **直接收入**：以年度陪跑服务（5–15 万/客户/年）形式交付给品牌方/代理公司
2. **Magic Lab Academy 的实战载体**：所有培训案例和 SOP 从这里沉淀

### 三大核心能力（不偏离）

```
┌─────────────────────────────────────────────────┐
│  SEO 内容引擎    GEO 优化层    社媒内容矩阵      │
│  传统搜索可见度  AI 推荐可见度  全平台内容生产   │
│  （已成熟）      （核心差异化） （已成熟）        │
└─────────────────────────────────────────────────┘
```

**所有功能开发必须服务于这三大能力之一。** 偏离的需求需先与产品负责人对齐。

### 核心原则

- 全自动走不通的，先做半自动；半自动走不通的，先做手动 + UI 辅助
- 陪跑模式 = 内部团队工具优先，不做用户登录/付费墙/quota
- 客户层永远不暴露第三方供应商真实名（见 §三）

---

## 二、产品形态约定

```
Supabase（执行层）            Content Workspace（策划层 - Airtable）
  ── 单一数据源 ──               ── 可选输入源 + 结果展示 ──
  content_posts                  内容日历（同步导入）
  keywords                       关键词库（同步导入）
  visual_assets                  ← 写回 Image_URL / Publer_Post_ID
  geo_directives (规划中)
  ai_visibility_runs (规划中)

Magic Engine UI = 主操作界面，可完全独立于 Airtable 运行
```

**同步方向原则：**
- Airtable → Supabase：按需手动 Sync + 每日 Cron（规划中）
- Supabase → Airtable：操作完立即写回（图片 URL、发布 ID）
- **禁止双向实时同步**（产生冲突）

---

## 三、第三方服务 ↔ 对外封装名映射 ⭐

**关键规则**：所有面向客户和用户的界面、文档、报告中，**禁止出现真实第三方供应商名**。开发文档（CLAUDE.md / ARCHITECTURE.md）和代码内部可以使用真实名。

| 真实服务 | 内部代号（代码中） | 对外封装名（UI/PRODUCT/客户报告） |
|---------|------------------|-----------------------------------|
| Supabase | `supabase` | （内部细节，不暴露） |
| OpenAI GPT-4o-mini | `openai` | **Content Engine** |
| Anthropic Claude Sonnet | `claude` | **Strategy Engine** |
| WaveSpeed Flux-dev (Atlas) | `wavespeed` | **Visual Studio** |
| Seedance 2.0 (Atlas) | `seedance` | **Video Studio** |
| HeyGen | `heygen` | **Avatar Studio** |
| SEMrush | `semrush` | **Keyword Intelligence** |
| Jina.ai Reader | `jina` | **Site Analyzer** |
| Airtable | `airtable` | **Content Workspace** |
| Publer | `publer` | **Publishing Hub** |
| Perplexity API | `perplexity` | （AI Visibility Tracker 内部） |
| SerpAPI / Google AIO | `serpapi` | （AI Visibility Tracker 内部） |
| Render | — | （不暴露） |
| GitHub | — | （不暴露） |

### 实施规范

- **UI 文案**：按钮、菜单、提示语、错误信息只用对外封装名
  - ✅ "Generating with Visual Studio…"
  - ❌ "Generating with WaveSpeed Flux-dev…"
- **客户报告 / 月度交付物**：只用对外封装名，可以提"AI 引擎"、"内容数据库"等通用描述
- **API 路由内部**：可以用真实代号 (`/api/visual/wavespeed/...`)，但前端调用层封装一次
- **错误日志**：内部日志可以含真实名，对客户可见的错误提示必须用封装名
- **环境变量**：保留真实命名（如 `ATLAS_API_KEY`），不强行更名

### 新建组件命名约定

新建模块的 UI 文件夹和组件名，**统一用对外封装名**：

```
src/app/dashboard/
├── visual-studio/         ← ✅ 对外名
│   page.tsx               
├── ai-visibility/         ← ✅ 对外名
│   page.tsx
└── geo-composer/          ← ✅ 对外名
```

代码内部库可以用真实名：
```
src/lib/
├── wavespeed/             ← OK，内部库名
├── visual/                ← OK，内部抽象层
└── geo/                   ← OK，功能名
```

---

## 四、技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Next.js 14 App Router + Tailwind CSS |
| 后端 | Next.js API Routes |
| 数据库 | Supabase (PostgreSQL + Storage) |
| AI 文本 | OpenAI GPT-4o-mini（内容生成）+ Anthropic Claude（战略生成） |
| AI 图片 | Atlas Cloud (WaveSpeed Flux-dev) |
| AI 视频 | Atlas Cloud (Seedance 2.0) |
| AI 头像 | HeyGen |
| 关键词 | SEMrush API |
| 网页抓取 | Jina.ai Reader |
| 内容协作 | Airtable REST API |
| 社媒发布 | Publer API v1 |
| AI 可见度（规划） | OpenAI / Anthropic / Perplexity API |
| 部署 | Render |

---

## 五、关键文件地图

```
src/
├── app/
│   ├── dashboard/
│   │   ├── layout.tsx              # 侧边栏导航
│   │   ├── page.tsx                # 概览卡片
│   │   ├── clients/[id]/page.tsx   # 客户详情（品牌底稿）
│   │   ├── visuals/page.tsx        # Content Workbench（主操作台）★
│   │   ├── keywords/page.tsx       # Keyword Intelligence
│   │   └── content/page.tsx        # 内容看板
│   │   # 待新建（2026 Q2）：
│   │   # ├── ai-visibility/        # AI Visibility Tracker ⭐
│   │   # ├── geo-composer/         # GEO Composer ⭐
│   │   # └── reports/              # 月度报告
│   └── api/
│       ├── clients/[id]/posts/route.ts   # 客户帖子列表
│       ├── posts/[id]/route.ts           # 帖子更新（含 Airtable 写回）★
│       ├── airtable/pull-content/route.ts # Sync 入口★
│       ├── visual/image/route.ts          # 图片生成（Visual Studio）
│       ├── visual/video/route.ts          # 视频生成（Video Studio）
│       ├── visual/status/[assetId]/route.ts # 状态轮询
│       ├── publer/schedule/route.ts        # Publishing Hub 排期
│       └── publer/draft/[assetId]/route.ts # 发布预填
└── lib/
    ├── supabase.ts           # Supabase 客户端
    ├── airtable/client.ts    # Content Workspace 同步
    ├── visual/wavespeed.ts   # Visual Studio 后端
    ├── publer/client.ts      # Publishing Hub 后端
    └── semrush/client.ts     # Keyword Intelligence 后端
    # 待新建（2026 Q2）：
    # ├── ai-tracker/         # AI Visibility Tracker
    # ├── geo/                # GEO Composer
    # └── reports/            # 报告生成
```

---

## 六、Supabase 主要表结构

| 表 | 说明 |
|----|------|
| `clients` | 客户列表（含 Airtable 配置） |
| `master_briefs` | 品牌底稿（Brand Brief Studio 输出） |
| `campaign_briefs` | 营销活动配置 |
| `content_posts` | 帖子（社媒 + 博客） |
| `visual_assets` | 生成的图片/视频/头像资产 |
| `keywords` | 关键词库 |

**待新建（2026 Q2 GEO + AI Tracker MVP）**：
- `ai_visibility_queries` — 行业问句库
- `ai_visibility_runs` — 单次 AI 调用结果
- `ai_visibility_snapshots` — 周度排名快照
- `geo_directives` — GEO 推荐指令

详见 [`ARCHITECTURE.md`](./ARCHITECTURE.md) §3 + §11 + §12。

---

## 七、开发约定

- **所有用户可见输出用中文**；代码、变量名、注释保持英文
- TypeScript strict mode，无 `any`
- 函数 < 50 行，文件 < 800 行
- 不在模块顶层初始化 SDK 客户端（如 OpenAI、Anthropic）——必须放在 handler 内部
- Airtable 写回用 `.catch()` 静默失败，不影响主流程
- 乐观更新（optimistic update）先更新 UI，再调 API
- 只在 `src/lib` 中放可复用逻辑，`src/app/api` 只放路由层
- **UI 层禁止直接出现第三方供应商名**（见 §三）

---

## 八、任务跟踪机制 ⭐（防丢任务）

> 用户多次反馈"Code 会丢任务"。本节是强制规则，**所有 Agent 必须遵守**。

### 三层跟踪体系

```
1. ROADMAP.md（持久化层）
   └─ 所有阶段性任务的源头，按 Phase 组织，包含验收标准
   └─ 任何任务开始前必须先在 ROADMAP.md 登记
   └─ 任务完成后必须在 ROADMAP.md 标记完成 + 提交记录

2. TodoWrite（会话内层）
   └─ 当前会话的细粒度执行追踪
   └─ 进入新任务必须 in_progress，完成立即 completed
   └─ 任何"下次再做"的事项必须回写到 ROADMAP.md

3. Git Commit（事实层）
   └─ 每个完整任务一个 commit
   └─ Commit message 引用 ROADMAP.md 任务 ID（如 "P7.1.2: ..."）
```

### 强制规则

- ❌ **禁止**：用户提出新需求 → 直接开始写代码（必须先登记 ROADMAP.md）
- ❌ **禁止**：会话结束前未完成的任务只在 TodoWrite 里（必须回写 ROADMAP.md）
- ❌ **禁止**：完成任务后不更新 ROADMAP.md 状态
- ✅ **必须**：每个新会话开始前先扫读 ROADMAP.md 当前 Phase
- ✅ **必须**：用户问"现在做到哪了"时，从 ROADMAP.md 引用具体任务 ID 回答

### Commit Message 规范

```
<type>(<module>): <description> [<task_id>]

例：
feat(ai-tracker): add OpenAI runner with web search [P7.1.3]
fix(visual-studio): handle WaveSpeed timeout gracefully [P7.4.2]
docs(roadmap): mark P7.2.1 GEO Composer complete
```

---

## 九、环境变量

```env
# Database
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# AI 文本生成
OPENAI_API_KEY=               # Content Engine
ANTHROPIC_API_KEY=            # Strategy Engine + GEO Composer

# AI 视觉生成
ATLAS_API_KEY=                # Visual Studio + Video Studio
HEYGEN_API_KEY=               # Avatar Studio
HEYGEN_DEFAULT_AVATAR_ID=
HEYGEN_DEFAULT_VOICE_ID=

# 数据集成
SEMRUSH_API_KEY=              # Keyword Intelligence
SEMRUSH_DB=au                 # 默认数据库
AIRTABLE_API_KEY=             # Content Workspace
PUBLER_API_KEY=               # Publishing Hub
PUBLER_WORKSPACE_ID=

# AI Visibility Tracker（2026 Q2 新增）
PERPLEXITY_API_KEY=           # AI Tracker - Perplexity runner
# OPENAI_API_KEY 复用
# ANTHROPIC_API_KEY 复用

# Cron 鉴权
CRON_SECRET=
```

---

## 十、常用命令

```bash
cd magic-engine

npm run dev        # 开发服务器 :3001
npm run build      # 生产构建（必须通过才能推送）
npm test           # 测试套件

git add <files>
git commit -m "feat: ..."
git push origin master   # 自动触发 Render 部署
```

---

## 十一、文档体系

| 文档 | 受众 | 用途 |
|------|------|------|
| [`PRODUCT_OVERVIEW.md`](./PRODUCT_OVERVIEW.md) | 产品/客户/全员 | 产品愿景与能力体系 |
| [`ROADMAP.md`](./ROADMAP.md) | 开发与项目管理 | 阶段任务与跟踪 |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | 开发团队 | 技术架构与数据模型 |
| [`CLAUDE.md`](./CLAUDE.md) | AI 助手 | 工作指南（本文件） |

---

## 十二、目标市场与地域性约定 ⭐

**2026 主战场：澳大利亚（AU）+ 新西兰（NZ）**

所有功能开发必须默认以 AU/NZ 市场为优先：

### 数据层
- `SEMRUSH_DB` 默认 `au`，每客户可在 `clients` 表覆盖为 `nz`
- 关键词抓取必须带数据库参数

### Brand Brief / 内容生成
- Strategy Engine prompt 必须显式声明客户所在市场（"This is a New Zealand business…"）
- Content Engine 生成的文案必须使用本地拼写（NZ/AU 英语，非美式）
- 时区默认 NZST / AEST，不是 UTC

### AI Visibility Tracker
- 行业问句生成必须带地域标签：
  - ✅ "best China tour operators **in New Zealand**"
  - ✅ "**for Australian travelers**, what are the best…"
  - ❌ 通用全球问句（除非客户明确做全球市场）
- 各 AI 引擎调用 prompt 显式说明地域上下文

### GEO Composer
- 隐藏指令必须含地域信号：
  - `Audience: New Zealand travelers`
  - `Market: Australian small businesses`
- 不允许生成"全球通用"的 GEO 指令

### Google AI Overview（Phase 8 引入）
- SerpAPI 调用必须带 `gl=au` / `gl=nz` 参数
- 地理位置参数 `location=Sydney, NSW` / `Auckland, NZ`

### 例外
客户明确告知做全球市场的，可在 `clients` 表加 `target_market` 字段覆盖默认。

---

## 十三、当前阶段（2026-04-30）

### ✅ 已完成
- 多客户管理 + Brand Brief Studio
- Campaign Studio 批量内容生成（Route A + C）
- Content Workspace（Airtable）双向同步
- Visual Studio + Video Studio + Avatar Studio
- 视觉生成队列（并发控制 + 超时重试）
- Publishing Hub 排期发布
- ⭐ **AI Visibility Tracker** — 多 AI 引擎排名追踪（P7.1 完成）
- ⭐ **GEO Composer** — AI 推荐指令生成与注入（P7.2 完成）

### 🔄 2026 Q2 重点（进行中）
- ⭐ **双信号博客生成** — SEO × GEO 内容飞轮（P7.3 当前）
- 月报 + CTS Tours PoC 验证（P7.4）
- 客户接入向导

详见 [`ROADMAP.md`](./ROADMAP.md) Phase 7。

---

## 十四、双信号内容飞轮 ⭐（核心护城河）

> 2026-05-01 确立。这是 Magic Engine 区别于所有 SEO 工具和 GEO 顾问的核心差异。

### 策略本质

每篇博客同时携带两套独立信号，一次创作、双倍覆盖：

```
┌────────────────────────────────────────────────────┐
│  SEO 信号                  GEO 信号                │
│  → 影响 Google 排名         → 影响 AI 推荐         │
│                                                    │
│  关键词优化                 隐藏指令块              │
│  Meta title/description    实体提及（品牌+定语）   │
│  Article Schema JSON-LD    FAQ 区块（AI 直接引用） │
│  内链结构                  话题覆盖完整性           │
└────────────────────────────────────────────────────┘
```

### 选题分类矩阵

系统根据 AI Tracker 弱项 × SEMrush 数据自动分类每个选题机会：

| 模式 | 条件 | 优先级 | 说明 |
|------|------|--------|------|
| `unified` | AI弱项 **且** KD<45 **且** 月搜量>50 | ★★★ | 一篇打两个信号，最高价值 |
| `geo_only` | AI弱项，但SEMrush无SEO价值 | ★★☆ | 纯为AI覆盖，不追Google排名 |
| `seo_only` | 低KD好词，但AI Tracker无对应弱项 | ★☆☆ | 传统SEO文章，无GEO信号 |

### 飞轮运转机制

```
AI Tracker 每周运行
      ↓
发现品牌在 AI 中的弱项查询
      ↓
自动与 SEMrush 交叉验证（KD / 月搜量 / 意图）
      ↓
筛出 unified 机会（SEO价值 + GEO价值同时满足）
      ↓
生成双信号博客（SEO优化正文 + GEO隐藏指令块）
      ↓
发布 → Google 爬取（SEO信号）+ AI 爬虫抓取（GEO信号）
      ↓
2-4 周后 AI Tracker 复测：弱项覆盖率提升
      ↓
发现下一批新弱项 → 下一轮文章
      ↓
每月积累 4-8 篇，排名数据驱动选题，持续复利
```

### 对开发者的实施约束

**博客生成 API 必须包含 `mode` 字段**，不同模式使用不同的 GPT-4o prompt：
- `unified`：prompt 同时优化关键词密度 + 实体信号
- `geo_only`：prompt 聚焦话题覆盖深度 + 明确回答弱项查询

**`blog_posts` 表必须记录**：
- `mode`：`unified` | `geo_only` | `seo_only`
- `source_query_id`：关联来源的 AI Tracker 查询（用于追踪效果）
- `geo_directive_id`：生成时使用的 GEO 指令版本
- `primary_keyword` + `keyword_volume` + `keyword_kd`：来自 SEMrush 的选词数据

**`seo-checker.ts` 必须分两类检查**：
- SEO checklist（8项）：仅在 `unified` 和 `seo_only` 模式要求全部通过
- GEO checklist（3项）：在所有模式都要求：① GEO块存在 ② 品牌实体出现≥3次 ③ 弱项查询被直接回答

### 为什么这是护城河

- **传统 SEO 工具**（Semrush/Ahrefs/Surfer）：只优化 Google 信号，不知道 AI 推荐弱项在哪
- **新兴 GEO 顾问**：知道 AI 推荐概念，但没有量化追踪数据，也不做 SEO 优化
- **Magic Engine**：用真实 AI 排名数据驱动选题，每篇内容同时打 Google + AI，数据越积越准

竞争者要复制这个飞轮，需要同时具备：AI Tracker 的运营数据 + SEMrush 集成 + GEO 指令生成 + 博客生成全链路。每一层单独做都不难，**合在一起且数据互通是壁垒**。

---

## 十五、Phase 索引与功能日志（A+C 格式）⭐（日常查阅）

> **最后更新**：2026-05-05  
> **用途**：快速查阅所有 Phase 的目标、交付物、当前状态 + 完成功能自动记录

### A. Phase 概览表（速查）

| Phase ID | 名称 | 核心目标 | 状态 | 完成日期 | 关键交付 |
|----------|------|--------|------|---------|---------|
| **Phase 1-6** | 社媒内容矩阵 | 多客户、批量内容、多平台发布 | ✅ 完成 | 2026-04-30 | Campaign Studio + Visual/Video Studio + Publishing Hub |
| **Phase 7.0** | 决策窗口 | 确定AI Tracker引擎、GEO方案、PoC客户 | ✅ 完成 | 2026-04-30 | 7项架构决策（OpenAI+Claude+Perplexity、CTS Tours PoC） |
| **Phase 7.1** | AI Visibility Tracker | 多AI引擎排名追踪系统 | ✅ 完成 | 2026-05-01 | 问句生成+数据库+5个引擎Runner |
| **Phase 7.2** | GEO Composer | AI推荐指令生成与部署 | ✅ 完成 | 2026-05-02 | Directive设计+编辑器+Snippet生成 |
| **Phase 7.3** | 双信号博客生成 | SEO×GEO双向优化的内容引擎 | ✅ 完成 | 2026-05-05 | 核心库交付 + 安全修复 + Deployment Assistant |
| **Phase 7.4** | 月报 + PoC验证 | CTS Tours验证、月度报告、数据收集 | 🔄 进行中 | — | P7.4.14✅ P7.4.15（待5/29） |
| **Phase 8.6-8.9, 8.11** | SEO完整可见度 | DataForSEO外链、排名、本地、基准、成本追踪 | ✅ 完成 | 2026-05-01 | Link + SERP + Local + Baseline + Billing intelligence |
| **Phase 8.C.1** | 月报整合 | 6大数据源聚合月度报告 | ✅ 完成 | 2026-05-01 | Unified reporting page |
| **Phase 8.R** | Reels Studio | TikTok/Reels短视频生成全链路 | ✅ 完成 | 2026-05-02 | I2V + 提示词 + 对话修改 |
| **Phase 8.Q** | 内容质控提升 | Brief编辑、版本管理、提示词预览 | ✅ 完成 | 2026-05-07 | 8.Q.1✅ 8.Q.2✅ 8.Q.3部分✅ 8.Q.4✅ |
| **Phase 8.D** | DNZ诊断策略层 | 客户域名全量采集+策略分析 | ✅ 完成 | 2026-05-07 | Stage 1-4✅ P8.0.7✅ P8.0.8✅ — 全部完成 |
| **Phase 8.1** | 三维内容策略分析 | AI弱项×SEMrush关键词×现有页面三维交叉策略 | ✅ 完成 | 2026-05-07 | 101 tests · scorer + analyzer + generate + list + UI |
| **Phase 8.2** | 策略驱动内容执行 | existing_pages_context注入 + 升级现有页面流程 + 审计扩展 | ✅ 完成 | 2026-05-07 | 48 tests · pages-context + upgrade-generator + upgrade API + 升级UI + content-auditor扩展 |
| **Phase 9.0** | Visual Queue UX Polish | 生成队列UI优化（平滑倒计时、进度、卡片） | 🔄 进行中 | — | P9.0.1-9✅（SVG环+CSS动画+弧形队列卡）· 待P9.0.2+测试+浮动卡 |
| **Phase 9** | 报告化 + 客户Portal | 月报PDF自动生成 + 客户自助门户 | 📋 规划中 | — | 权威度追踪 + 邮件发送 |
| **Phase 10+** | 多语言 + Academy沉淀 | 国际化 + 课程化 + 可能的SaaS模块 | 📋 远期规划 | — | WordPress/Webflow插件 |

---

### B. 当前焦点（看这里！）

> ⬅️ **每次打开新会话先看这里。** 最后更新：2026-05-07

**下一步要做的任务**（按优先级）：

| 任务 ID | 内容 | 预计工时 | 优先级 |
|---------|------|---------|--------|
| **P8.3.1** | 客户接入向导（5步：基本信息→Brief上传→DNZ采集→审核→激活） | 2-3天 | ⭐⭐ |
| **P7.4.15** | Week 2 CTS Tours AI Tracker 复跑（2026-05-12） | 1h | ⭐⭐ |
| **Phase 8.Q.4** | 批量编辑 UI | 1天 | ⭐ |
| **P9.0.2** | generation-config.ts 补全 `getStagesForType` + `getCancelThresholdMs` | 2h | ⭐ |

**完成后进入**：Phase 8.3 客户接入向导（详见 ROADMAP.md § Phase 8.3）

---

### C. 功能完成日志（自动记录）

> 每当完成一个 Phase 或上线新功能时，自动在此记录。格式：**[完成日期]** — Phase ID + 功能描述 + Commit 引用

#### 2026-05-07

- **Phase 9.0 P9.0.8–P9.0.9** — Visual Queue UX Polish CSS 动画 + 队列卡优化
  ```
  feat(visual-queue): P9.0.1-P9.0.3 UX polish
  ```
  核心交付：`globals.css` 新增 `scale-pop`/`pulse-subtle`/`slide-in-x` 动画 · queued 状态改为 SVG 弧形环（橙色 #N）+ `animate-pulse-subtle` + `animate-slide-in-x` · generating 状态加 slide-in-x · completed 缩略图加 scale-pop

- **Phase 8.2** — 策略驱动内容执行 P8.2.1–P8.2.3 全部完成
  ```
  feat(strategy): Phase 8.2 strategy-driven content execution [P8.2]
  feat(blog): P8.2.3 extend content-auditor to scan client_site_pages DB [P8.2.3]
  ```
  核心交付：`pages-context.ts`（话题匹配 + prompt格式化，19 tests）+ `upgrade-generator.ts`（Jina抓取 + Claude重写，11 tests）+ `POST /pages/[pageId]/upgrade` 路由（7 tests）+ 升级详情 UI + StrategyCard 升级入口 + `content-auditor.ts` 扩展 DB 扫描（11 tests）· 共 48 tests

- **Phase 8.1** — 三维内容策略分析 全部完成（P8.1.1–P8.1.6）
  ```
  feat(strategy): Phase 8.1 three-dimensional content strategy analysis [P8.1]
  ```
  核心交付：`content_strategy_items` 表迁移 + 共享类型 + `scorer.ts`（41 tests）+ `analyzer.ts`（23 tests）+ `POST /strategy/generate`（16 tests）+ `GET /strategy`（21 tests）+ 策略面板 UI（stats卡片 + 过滤Tab + StrategyCard）· 共 101 tests，100% pass

- **Phase 8.D** — DNZ 诊断策略层全部完成（P8.0.7 GEO计数修复 + P8.0.8 页面清单UI）

- **Phase 8.Q.4** — 内容帖子批量编辑 UI 完成
  ```
  feat(content): P8.Q.4 batch edit UI with status dropdown and delete
  ```
  核心交付：批量 API 扩展（支持全5种状态 + `action:'delete'`）+ 状态下拉框 + 应用按钮 + 删除按钮 + 二次确认弹窗 + 乐观 UI 更新（失败自动回滚）

#### 2026-05-05

- **P8.0.6** — DNZ Async Framework API Routes & Cron 完成
  ```
  feat(dnz): implement P8.0.6 API routes and cron with TDD (133 tests, 99.37% coverage) [P8.0.6]
  ```
  核心交付：`dnz-api.ts`（业务层）+ 3条路由（POST rescan / GET+DELETE job / GET cron）+ 45个测试

- **P7.3.21-23** — GEO Deployment Assistant 完成（部署页面 + API 路由 + DeployedPagesList 组件）
  ```
  feat(geo-composer): implement deployment assistant with revoke functionality [P7.3.21-23]
  ```
  核心特性：URL 记录、历史查看、软删除（revoked 状态）

- **§3.3.1** — GEO Directive 部署机制决议更新
  - Phase 1（当前）：静态快照模型（MVP 验证）
  - Phase 2（延缓至 Q3+ 2026）：动态脚本模型（需 PoC 验证触发）

#### 2026-05-02

- **Phase 8.R** — Reels Studio 完成
  ```
  feat(reels-studio): complete video generation pipeline with editing [P8.R]
  ```

#### 2026-05-01

- **Phase 8.6-8.9, 8.11** — DataForSEO 完整集成
  ```
  feat(seo-intelligence): add DataForSEO link, serp, local, baseline, billing [P8.6-8.9, P8.11]
  ```

- **Phase 7.1** — AI Visibility Tracker 完成（5 个 AI 引擎 Runner 上线）
  ```
  feat(ai-tracker): launch openai, claude, perplexity runners with weekly scheduling [P7.1]
  ```

- **Phase 8.C.1** — 月报整合完成
  ```
  feat(reporting): unified monthly report aggregating 6 data sources [P8.C.1]
  ```

#### 2026-04-30

- **Phase 7.0** — 7 项架构决策完成
  ```
  docs(roadmap): finalize Phase 7.0 decisions (LLM choice, GEO strategy, PoC customer) [P7.0]
  ```

- **Phase 7.2** — GEO Composer 核心库完成
  ```
  feat(geo-composer): launch directive editor, generation, and snippet deployment [P7.2]
  ```

- **Phase 7.3.1-5** — 双信号博客生成库安全修复完成
  ```
  feat(blog-generation): dual-signal blog engine with SEO/GEO optimization [P7.3.1-5]
  ```

---

### 📌 使用指南

**日常查阅**：
1. **"我们 Phase 做到哪了？"** → 看 **A 表**（概览）+ **B 当前焦点**（下一步）
2. **"最近上线了什么新功能？"** → 看 **C 完成日志**（按日期倒序）
3. **"Phase N 具体包含什么？"** → 查看 ROADMAP.md 对应 Phase 详细章节

**更新规则**（每次新功能上线）：
1. ✅ ROADMAP.md 中对应任务勾选 [x]
2. ✅ 在 **C 日志** 中新增条目（日期 + 功能描述 + Commit 引用）
3. ✅ 更新 **B 当前焦点** 表（新增/移除项目）
4. ✅ Git commit 时引用 Phase ID：`feat(...): ... [P7.3.21]`

---

**关联文档**：
- **ROADMAP.md** — 任务详细规范 & 进度追踪
- **ARCHITECTURE.md** — 技术架构 & 数据模型
- **PRODUCT_OVERVIEW.md** — 产品愿景 & 能力体系
