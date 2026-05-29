# Magic Engine — Agent 工作指南

> 每次打开新会话：先看底部 **§ 当前焦点** → 按需读 [ROADMAP.md](./ROADMAP.md)。

**输出语言**：对话和说明**一律用中文**，**无论用户用什么语言提问**（包括纯英文）。代码 / 变量 / 注释保持英文。

---

## 产品战略方向（2026-05-18 确立）⭐

> **DataForSEO 提供数据地基 → Magic Engine 在上面跑自动化执行引擎 → 同时覆盖 Google SEO + AI 搜索两个战场**

Magic Engine 的核心护城河不是数据（数据可以买），而是**执行自动化**：诊断发现问题后，平台自动生成并执行修复动作，结果回流归因，形成飞轮。

竞品定位：
- **SEMrush**：数据基础设施（Magic Engine 的上游，不是竞争对手）
- **Search Atlas / OTTO**：最接近的竞品方向，但 OTTO 只覆盖 Google SEO 一个战场，**Magic Engine 同时覆盖 Google SEO + AI 搜索（GEO），这是 2026 真正的差异化窗口**
- **DataForSEO**：数据层供应商，替代 SEMrush 直连 API，节省 96–99% 数据成本

---

## 项目定位

Magic Engine 是 Magic Lab 2026 旗舰产品，**四大模块**（不偏离）：

| 模块 | 封装名 | 状态 | 核心功能 |
|------|--------|------|---------|
| **SEO** | SEO 内容引擎 | ✅ 成熟 | 关键词情报、双信号博客（SEO×GEO）、AI 可见度追踪 |
| **社媒** | 社媒内容矩阵 | ✅ 成熟 | 多客户 Brand Brief、Campaign 批量生成、视觉工坊、多平台发布 |
| **广告** | Ads Intelligence | 🔄 建设中 | 多平台广告账户连接、AI 诊断引擎、一键 Fix / Talk to Us |
| **数据** | Insight Reports | 📋 规划中 | 月报 PDF 自动生成、客户 Portal、跨模块数据聚合 |

**广告模块四平台优先级**：Meta（已有 MCP）→ Google Ads（申请 developer token）→ TikTok → LinkedIn

**Fix vs Talk to Us 边界**：
- ✅ Fix（可自动执行）：暂停亏损关键词、调整出价、添加否定词、启停广告
- 🔴 Talk to Us（需人工介入）：重构广告系列结构、预算策略调整、创意方向、跨账户决策

原则：全自动→半自动→手动+UI 辅助；内部工具优先，不做付费墙；客户层不暴露第三方供应商名。

---

## 第三方服务封装名 ⭐

UI / 报告 / 客户交付物中**禁止出现真实供应商名**，只用封装名：

| 真实服务 | 封装名（UI 对外） |
|---------|----------------|
| OpenAI GPT-4o-mini | **Content Engine** |
| Anthropic Claude Sonnet | **Strategy Engine** |
| WaveSpeed / Atlas | **Visual Studio** |
| Seedance / Atlas | **Video Studio** |
| HeyGen | **Avatar Studio** |
| SEMrush | **Keyword Intelligence** |
| Jina.ai Reader | **Site Analyzer** |
| Airtable | **Content Workspace** |
| Publer | **Publishing Hub** |

规则：UI 文案用封装名；API 路由内部可用真实代号；错误日志内部可含真实名；环境变量保留真实命名（如 `ATLAS_API_KEY`）。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Next.js 14 App Router + Tailwind CSS |
| 后端 | Next.js API Routes |
| 数据库 | Supabase (PostgreSQL + Storage) |
| AI 文本 | OpenAI GPT-4o-mini + Anthropic Claude Sonnet |
| AI 图片/视频 | Atlas Cloud (WaveSpeed Flux-dev + Seedance 2.0) |
| AI 头像 | HeyGen |
| 关键词/SEO | SEMrush API + DataForSEO |
| 网页抓取 | Jina.ai Reader |
| 内容协作 | Airtable REST API |
| 社媒发布 | Publer API v1 |
| 部署 | Render（`git push origin master` 触发） |

---

## 开发约定

- TypeScript strict mode，无 `any`；函数 < 50 行，文件 < 800 行
- SDK 客户端（OpenAI、Anthropic 等）**必须在 handler 内部初始化**，不在模块顶层
- Airtable 写回用 `.catch()` 静默失败，不影响主流程
- 乐观更新：先更新 UI，再调 API
- 可复用逻辑放 `src/lib`，路由层只放 `src/app/api`
- UI 层禁止出现第三方供应商真实名
- **外科手术式改动**：只改必须改的，不顺手"优化"相邻代码、注释或格式；风格与现有代码保持一致
- **写前先读**：修改任何文件前，先读该文件的 exports、直接调用方、共享工具函数；不确定某段代码为何如此设计时，先问再改

---

## 任务跟踪（防丢任务）⭐

三层体系：**ROADMAP.md**（持久化）→ **TodoWrite**（会话内）→ **Git commit**（事实层）

强制规则：
- 新需求必须先登记 ROADMAP.md，再开始写代码
- 会话结束前，未完成任务必须回写 ROADMAP.md（禁止只留在 TodoWrite）
- Commit message 格式：`feat(module): description [P8.3.2]`
- 完成后在 ROADMAP.md § 9 功能完成日志 追加记录

---

## Phase 12 工作协议（飞轮数据闭环）⭐⭐⭐

> 启动日期：2026-05-17。为**非技术 PM** 设计的「踩扎实」协议，不追快。详见 [ROADMAP.md § Phase 12](./ROADMAP.md)。

### 协作准则（强约束，每个任务必须遵守）

1. **每个任务 = 一个独立 commit**（P12.A.1 – P12.A.15 共 15 commit），便于逐条 review / revert
2. **每完成一个任务，必须做三件事**：
   - 在 ROADMAP.md § Phase 12 勾选对应 checkbox
   - commit message 带 `[P12.A.X]` 后缀
   - 在 ROADMAP.md § 9 功能完成日志追加一行 ≤30 字的「人话总结」
3. **每个 commit 必须附 PM-review 卡片**（让 PM 不读代码也能 review）：
   - 改了什么**用户能感知**的事？
   - 加/改了什么**数据**？
   - 如果这次**回滚**，会丢什么？
4. **三个里程碑关卡，不通过不许往下**：
   - **M1 地基**（P12.A.1–3 完成）：`npm run build` 通过 + Supabase 后台能看到 3 张新表
   - **M2 第一个 adapter**（P12.A.4–6）：本地 dev server 点击"在 GEO 中执行"能弹抽屉、能落库
   - **M3 端到端 demo**（P12.A.7–13）：CTS 真实数据跑出第一条 outcome 卡片

### Session 管理

- **主动提醒开新会话**：每过一个里程碑（M1/M2/M3）后，或单会话上下文超过约一半时，**Claude 必须主动告知**
- **新会话启动**：PM 只需说"继续 Phase 12 第 X 任务"，X 来自**上个 session 的告别信息**（首选）或 **CLAUDE.md § 当前焦点表第一行**（备选）
- **会话结束信号（强制格式）**：Claude 最后一条消息**必须**包含字面量的下一会话启动咒语，例如：
  ```
  ✅ 已 commit & push (PR #123 状态: open)。
  📋 下一个会话第一句话: `继续 Phase 12 第 2 任务 P12.A.2`
  ```
- **当前焦点维护**：每完成一个任务，必须更新 CLAUDE.md § 当前焦点表（移除已完成行 / 把下一个任务挪到第一行）
- **会话结束前**：当前进度必须**回写**到 ROADMAP.md（禁止只留在 TodoWrite）

### Git 工作流（强约束，每个 session 必须遵守）

- **工作分支**：
  - Phase 12.A（已完成）：`feat/phase-12-flywheel`，已 merge 到 main
  - **Phase 12.Q 起每个 sub-phase 用独立分支**，命名格式 `feat/phase-12-{letter}-{slug}`；Phase 12.Q 实施分支为 `feat/phase-12-q-content-quality`，ROADMAP 登记 PR 用 `chore/roadmap-phase-12q-registration`
- **每个 session 开头必跑 3 项检查**（任何一项失败立即停下问 PM）：
  1. `git status` 必须干净（无未提交改动）
  2. `git branch --show-current` 必须返回当前 sub-phase 的工作分支
  3. `git fetch origin && git status -sb` 必须无 diverge
- **每个 session 结束前必做**：commit + `git push origin feat/phase-12-flywheel`，最后一句话告诉 PM "已 commit & push，可以关闭"
- **PR 策略**：Phase 12.A 全部 15 commit 完成后**一次性开 PR 到 main**，不要每任务一个 PR
- **绝对禁止**：force push / rebase main / 直接 commit 到 main / 删除任何 `feat/*` 或 `claude/*` 分支
- **多 session 安全**：开新 session 前 PM 必须确认上一个 session 已关闭；同一时间禁止两个 session 同时改文件

### PM 在 Phase 12 期间的手动职责（你必须做的）

Claude 不能替你做这些（无法跨 session 自驱动），需要你当"调度员"：

1. **会话切换**：上个 session 发出"已 commit & push，可以关闭"信号后，**你**关闭旧窗口、打开新窗口
2. **启动咒语**：新会话第一句话固定为 `继续 Phase 12 第 X 任务`（X = 下一个 P12.A.X 编号）
3. **PM-review 卡片决策**：每个 commit 完成后看三个问题（用户感知 / 数据改动 / 回滚损失），回 OK 或 revert
4. **里程碑验证关卡**（不通过禁止 Claude 往下走）：
   - **M1**：打开 Supabase 后台，确认能看到 `flywheel_actions` / `flywheel_metrics` / `flywheel_outcomes` 3 张新表
   - **M2**：打开 `http://localhost:3001/dashboard/clients/[id]/execution`，点击 GEO 任务"在 X 中执行"按钮，确认抽屉弹出
   - **M3**：在执行看板看到一条 outcome 卡片（含 baseline / after / verdict）
5. **远程同步**：**Claude 自动做** — session 结尾用 `gh` CLI（`gh auth status` 验证可用 → `gh pr view` / `gh run list`）确认远程已更新，结果写进 PM-review 卡片。若 `gh` 未配置，降级为打印远程 commit URL 让 PM 自查
6. **PR 准备 + merge**：M3 通过后 Claude 用 `gh pr create` **自动开 PR**，并提示"输入 `go merge` 我用 `gh pr merge --squash --delete-branch` 合并"。**未收到 `go merge` 指令之前 Claude 不会自动 merge 到 main**（merge 是不可逆操作，必须 PM 显式授权）

### 飞轮架构原则（不可偏离）

- **四飞轮**：`seo` / `geo` / `ads` / `social`（注意：第 4 飞轮是 GEO，**不再是** `insight_reports`）
- **三种执行形态**：
  - `in_house`：Magic Engine 内自研工作台（SEO 内容、GEO Composer、社媒内容制作）
  - `third_party`：编排第三方平台（如 markisfact、Publer、Meta Ads Manager）
  - `external_manual`：FDE 完全外部完成（reputation、newsletter、电话外呼等）
- **数据必须回流到 Magic Engine 的统一表**（`flywheel_actions` / `flywheel_metrics` / `flywheel_outcomes`），这是核心护城河，不管 vendor 是谁
- **6 诊断维度不动**：`seo` / `ai_visibility` / `ads` / `social` / `reputation` / `competitor`
- `reputation` + `competitor` 维度只诊断不接入飞轮（FDE 外部完成，符合现有设计）

### 试点客户分配

- **CTS Tours**：GEO + SEO + Ads（已有 Meta 广告投放真实数据）
- **Oztop**：SEO + GEO

---

## 目标市场：AU / NZ ⭐

- `SEMRUSH_DB` 默认 `au`；每客户可在 `clients` 表覆盖为 `nz`
- 内容生成 prompt 必须显式声明市场（"This is a New Zealand business…"）
- 文案使用 AU/NZ 英语拼写，时区默认 NZST / AEST，不是 UTC
- AI Tracker 问句必须带地域标签（"best X **in New Zealand**"）
- GEO 指令必须含地域信号（`Audience: NZ travelers`）
- SerpAPI 调用带 `gl=au` / `gl=nz` + `location=Auckland, NZ`

---

## 双信号内容飞轮（核心护城河）

每篇博客同时携带 SEO 信号（关键词 + Schema + 内链）+ GEO 信号（隐藏指令块 + 品牌实体 + FAQ），选题由 AI Tracker 弱项 × SEMrush 低 KD 机会交叉驱动。详见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

**开发约束**：博客生成 API 必须有 `mode` 字段（`unified` / `geo_only` / `seo_only`）；`blog_posts` 表必须记录 `mode`、`source_query_id`、`geo_directive_id`、`primary_keyword` + `keyword_volume` + `keyword_kd`。

---

## 常用命令

```bash
npm run dev        # 开发服务器 :3001
npm run build      # 生产构建（推送前必须通过）
npm test           # 测试套件
git push origin master   # 触发 Render 部署
```

文档：[ROADMAP.md](./ROADMAP.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [PRODUCT_OVERVIEW.md](./PRODUCT_OVERVIEW.md)

---

## 当前焦点 ⬅️ 每次打开先看这里

> 最后更新：2026-05-29 14:32 NZST （**Phase 14.B P14.B.0–7 全部完成** ✅，等 PM 验收 + merge）

| 任务 ID | 内容 | 优先级 |
|---------|------|--------|
| **PM 操作 🔴** | Supabase 跑 migration：`20260530000002_phase14b_wp_publish_quality.sql` | ⚠️ 待操作 |
| **PM 验收 P14.B** | M1：WP Settings → Yoast 卡 + 验证安装；分类 ID 编辑器；M2：发布测试 rollback / GSC 按钮 | ⚠️ PM 验收 |
| **go merge** | PM 输入 `go merge` 合并 Phase 14.B PR #120 到 main | ⚠️ PM 授权 |
| **PM 决定** | 下一 Phase：Phase 21（AI Factory）/ Phase 22（Data Engine）/ Phase 18.A（Meta Ads） | ⚠️ PM 决定 |

**已完成全景（最近几个 Phase）**：
- ✅ **Phase 14.B 全部 P14.B.0–7**（PR #120，2 commit）：
  - P14.B.0: migration（yoast_plugin_installed, wp_default_category_id, quality_check）
  - P14.B.1: Yoast probe（mu-plugin snippet + 验证安装 按钮）
  - P14.B.2: rollback WP draft（DELETE 远程草稿 + rolled_back 状态）
  - P14.B.3: GEO 城市一致性（generator 注入 authoritativeLocation + DirectiveEditor 警告）
  - P14.B.4: 内链 QC check（internal-link-checker.ts + quality_check JSONB）
  - P14.B.5: primary_keyword 缺失橙色警告
  - P14.B.6: WP 默认分类 ID（Settings UI + PATCH route）
  - P14.B.7: GSC 索引请求按钮（Indexing API + re-auth 降级）
- ✅ **Phase 14.A.1–8**：WP + Shopify connector 全部完成，已推送
- ✅ **Phase 23 完整闭环**（PR #112）：L3 记忆四表 + MemoryService + 四 Agent 注入 + 自动抽取器 + FDE 记忆库页

**下一候选**：
- 📋 **Phase 21** — AI Factory
- 📋 **Phase 22** — Data Engine
- 📋 **Phase 18.A** — Meta Ads MVP

下一 session：`go merge` 合 PR #120 → Render 部署 → `继续 Phase 21` / `继续 Phase 22` / `开始 Phase 18.A`（等 PM 决定）

**更新规则**（每次上线新功能）：
1. ROADMAP.md 勾选对应任务 checkbox
2. 更新本表（移除已完成，加入新任务）
3. 在 ROADMAP.md § 9 功能完成日志 追加一条记录
4. commit 引用 Phase ID：`feat(...): ... [P12.A.X]`
