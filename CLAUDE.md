# Magic Engine — Agent 工作指南

> 每次打开新会话：先看底部 **§ 当前焦点** → 按需读 [ROADMAP.md](./ROADMAP.md)。

**⚠️ 必读规则（每次会话开始前强制执行）：**
- [`~/.claude/rules/coding-style.md`](~/.claude/rules/coding-style.md) — 含「删除代码前的强制流程」，**PM 反问 ≠ 删除指令**
- [`~/.claude/rules/development-workflow.md`](~/.claude/rules/development-workflow.md) — 含「删除决策：先读意图，再动手」步骤 0.5
- **§ Codex 协作分工**（见下方）— ME 项目 Claude Code 主导，Codex 辅助，PM 不亲自分配 Codex 任务

**输出语言**：对话和说明**一律用中文**，**无论用户用什么语言提问**（包括纯英文）。代码 / 变量 / 注释保持英文。

---

## Codex 协作分工（PM 强约束）⭐

> ME 项目里 PM 同时开多个 Claude Code 窗口并行做事，**Claude Code 是主导，Codex 是辅助**。Codex token 便宜，适合大量精准修复 + 测试覆盖。**PM 不亲自给 Codex 派活，由 Claude Code 统筹分配。**

### 核心原则

1. **单文件单负责人**：同一时间一组相关文件只允许一个代理写入。
2. **先分工，后动手**：开工前先明确每个任务的 owner，会碰共享组件 / route / schema 必须先确认边界。
3. **小步提交**：每个完整改动一个独立 commit，不混不相关修复。
4. **交接必须可验证**：留下改了什么 / 跑了什么测试 / 还有什么风险。
5. **不并行改同批文件**：必须并行就物理隔离（独立 worktree / 独立分支）。

### 分工边界

| 任务类型 | 主担 | 原因 |
|---------|------|------|
| 大范围重构 / 批量迁移 | **Claude Code** | 需要全局视野 + 多轮试错 |
| 长链路实现（跨模块端到端）| **Claude Code** | 持续上下文 |
| 复杂调试（涉及多文件因果）| **Claude Code** | 子牙判断 + 多 agent 协作 |
| 架构决策 / 战略判断 | **Claude Code（含子牙）**| 不可下放 |
| **精准 bug 修复**（单文件局部）| **Codex** | 便宜、专注 |
| **补单元测试 / 回归测试** | **Codex** | 模板化工作 |
| **修测试断言不一致** | **Codex** | 低风险机械任务 |
| **死代码清理 / 文案对齐** | **Codex** | 范围窄 |
| **API 端点小幅扩展** | **Codex** | 有现成 pattern |
| **审查 Codex 的修复** | **Claude Code 调用子牙** | 防 Codex 撒谎 / 漏覆盖 |

### Codex 任务交付要求（PM 转发提示词时必带）

每次给 Codex 派活，提示词必须包含：

1. **明确文件清单**（绝对路径 + 行号范围）
2. **明确 owner 声明**：「本任务由你独占，期间 Claude Code 不会动这些文件」
3. **验证清单**：
   - 测试命令（具体到 `npx vitest run <path>`）
   - 预期测试数
   - build 验证（`npm run build`）
4. **交接证据要求**：
   - 分支名 / commit hash / PR 号
   - 改动 diff 概要
   - 测试输出
5. **撒谎防御**：「如未真实落地代码，不要谎报通过；上次曾发生 Codex 声称修复但仓库无此 commit 的事故」

### 子牙复审（强制）

**任何 Codex 交付的 PR 在 merge 前必须由子牙 agent 复审**，重点：

1. **真实性**：commit 是否真的存在（不是幻觉）
2. **测试覆盖**：测试数量是否对得上（Codex 容易虚报）
3. **变异测试**：故意改坏校验逻辑，对应测试是否会 fail（防空架子测试）
4. **边界覆盖**：Codex 容易只覆盖 happy path 漏边界
5. **架构旁路**：校验放在最里层，确认无 API 绕过

子牙复审通过才能 merge。**PM 不亲自审 Codex 代码**——交给 Claude Code 调用子牙处理。

### 冲突处理

- 同文件被另一代理修改 → 先停，比对差异再决定
- 两代理都在改同一功能 → 一主一辅，不双写
- 分支已分歧 → 先 commit 当前进度，再基于最新 commit 重新接手
- **多 Claude Code 窗口并行** → 各自用独立 worktree（`git worktree add`），不共用同一物理目录的脏文件

### 一句话总结

> **PM 不分配 Codex 任务，Claude Code 统筹。Claude Code 写提示词 + 子牙复审 + 决定 merge。Codex 干便宜的精准活，Claude Code 干贵的复杂活。**

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
| 部署 | Render（监听 `main`，PR 合并后自动部署） |

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

## Phase 管理原则（PM 强约束）⭐

**不要轻易新建 Phase**。新功能优先归入现有 Phase，只有满足以下条件才开新 Phase：
- 涉及全新的战略模块（新的飞轮支柱 / 新的用户角色）
- 工作量 ≥ 5 个独立任务，且与现有 Phase 逻辑不相关
- PM 明确指示「这是新 Phase」

**归入现有 Phase 的判断顺序**：
1. 先看功能属于哪个模块（SEO / 社媒 / Ads / Portal / 基础设施）
2. 找最相关的现有 Phase，作为子任务（如 P21.B.8 / P20.D.3）
3. 在 ROADMAP 对应 Phase 的任务清单里追加，不新建章节
4. 只有找不到归属时，才向 PM 确认是否新建 Phase

**待归入的积压任务**（已登记为 Phase 28，实际应并入现有 Phase）：
- **FDE Inbox / 待处理收件箱**：执行看板顶部「📥 未读」聚合视图 + `reviewed_at` 字段 → 应归入 **Phase 20.D**（统一看板扩展）

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
# Render 监听 main，PR 合并后自动部署，无需手动推
```

文档：[ROADMAP.md](./ROADMAP.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [PRODUCT_OVERVIEW.md](./PRODUCT_OVERVIEW.md)

---

## 当前焦点 ⬅️ 每次打开先看这里

> 最后更新：2026-06-03 22:55 NZST （**Phase 33 M4 上线 — Goal 详情页执行进度摘要（PR #304 merged）**）

| 任务 ID | 内容 | 优先级 |
|---------|------|--------|
| **🧪 Phase 33 P33.9/P33.10 测试待跑** | PR #302 已 merged。回 CTS 执行看板验证：①点 Goal filter 后状态 chips 数字真变小（之前 38/11/20 不变）②「📥 未归类 Actions」分组出现（应含 ~52 条 placeholder 绑定 action）③Bulk-migrate 一条 action 后从未归类消失 | ⚠️ 今日晚上跑 |
| **🧪 Phase 33 M4 测试待跑** | PR #304 已 merged。回 CTS Goal 详情页验证：①顶部 Execution Progress 卡片出现（数字 vs Supabase 对得上）②Initiative 卡片展开后右上角 X/Y actions done 完成率 chip ③Campaign 已关联列表里有状态点（active/paused）| ⚠️ 今日晚上跑 |
| **A3 案例沉淀** | 把 CTS/Oztop Phase 31/33 跑通经验固化到 Clients/ 笔记 | 📋 半天 |
| **A2 Goal 主指标 auto-fetch** | GA4 / Brand search volume / Form submissions 自动读 current_value | 📋 中 / 1-2 天/源 |
| **B1 AU/NZ Marketing Index** | 独立项目战略议题，Q4 2026 评估 → Q1 2027 启动 MVP | 📋 战略级 / 6-8 周 |
| **PM 操作（Meta Ads）🔴** | Render 设 `META_SYSTEM_USER_TOKEN`（长效 System User Token），否则执行看板「直接执行 (Meta API)」返回 424 | ⚠️ 待操作 |
| **PM 操作 🔴** | GitHub repo Secrets 添加 `CRON_SECRET`（Phase 30/31 共用，月度/每日 cron 才能跑） | ⚠️ 待操作 |
| **GBP.0** | Google Cloud：enable Business Profile API + Account Management API | ⚠️ PM 操作 |

**已完成全景（最近几个 Phase）**：
- ✅ **Phase 22.A.2 GA4 每日采集**（PR #225 merged，实际已上线）：每日 3am UTC cron 把 GA4 5 指标（sessions / users / pageviews / bounce_rate / avg_session_duration）写入 `flywheel_metrics`，前缀 `seo.ga4.*`。CTS Tours NZ 已验证最近一次 2026-06-03 03:00 UTC 跑过。**之前 ROADMAP 标"待开发"是文档滞后，2026-06-03 清理**
- ✅ **Phase 33 M4 — Goal-level Execution Summary**（2026-06-03，PR #304 merged）：子牙 review 修正版（合并 P33.11+P33.12 为一套数据双视角）。新 `GET /api/goals/[goalId]/execution-summary` 一次聚合返回；ExecutionSummaryBar 顶部 4-stat row + 完成率进度条；InitiativeExecutionPanel 加完成率 chip + Campaign 状态点。修复 3 个子牙杀手锏 bug：skipped 排出分母 / 死 campaign ID 过滤 / paused campaign 不漏算。9 个新测试，97/97 strategy lib 全过
- ✅ **Phase 33 P33.9/P33.10 修复**（2026-06-03，PR #301 + #302 merged）：状态 chips 数字跟 Goal filter 变化；「未归类 Actions」分组判断条件扩展为 `null || initiative_type='unassigned' placeholder`；endpoint 不再过滤 unassigned；PlanGenerator 前端补 filter 排除下拉。**测试待跑**（见焦点表第一行）
- ✅ **A1 reputation 公式修复**（2026-06-03，PR #298 + #300 merged）：RATING 0.60→0.70 / REVIEW 0.40→0.30 / MAX_REVIEWS 100→30 + 抽出纯函数 `scoreReputation()` 预留 TripAdvisor/ProductReview 字段（A2 接驳零改动）+ GBP 查询从 domain → "name+city+country"。CTS Tours NZ reputation 44 → ~71（进入健康区间）
- ✅ **诸葛亮全局工作台 FAB**（2026-06-03）：清除 batch merge 残留冲突标记 + 恢复完整 Workbench FAB 设计（当前线程/待处理摘要/下一步建议/最近线程/快捷切换）+ hover-fan 鼠标悬停展开 + z-30 让 drawer 自动遮盖
- ✅ **Phase 33 M1-M3**（2026-06-03，PR #299 merged + migration 已应用）：Strategy-Execution Bridge — initiatives 加 campaign_ids、marketing_plans 加 initiative_id、Initiative 卡片展开关联 Campaign + 生成 Plan、Kanban Goal filter + Initiative badge + Unassigned 分组
- ✅ **QA 测试加固轮**（2026-06-02 下午，6 个 PR）：CF AI Gateway 401 修复（PR #248）+ Client portal 按钮 UI（PR #270）+ initiatives PATCH 三道闸校验（PR #290）+ outcomeChip/buildExecutionGroups 回归测试（PR #293）+ zhangqian/connectors 内部 HTTP 自调用根治（PR #297）+ Codex 协作分工规范写入 CLAUDE.md
- ✅ **Phase 32 Goal sub_types + decrease + multi-active**（2026-06-02，PR #294）：Phase 31 自然延伸
- ✅ **Phase 31 Strategy Layer (Beta)**（2026-06-02，PR #259）：Goal→Initiative→Action 三层骨架 + 4 步向导 + 诸葛亮 Sonnet 润色 hypothesis + 90 天 verdict 自动归档 + Goal 历史页 + 每日 cron
- ✅ **Phase 30 Industry Baseline Engine**（2026-06-02，PR #251）：5 细分 / 44 域名 / 月度 cron 自动重跑 / 华佗实时读基准（含 city 维度命中）

**下一候选（按优先级）**：
1. 🔨 **A2.1 GA4 → Goal current_value** — Goal 详情页主指标卡片自动从 flywheel_metrics 读 GA4 sessions/users 当月汇总（1-2 天，会话中进行）
2. 📋 **A2.2 Brand search source** — 从 GSC 读品牌搜索量当月聚合（1-2 天）
3. 📋 **A2.3 Form/Order source** — 表单提交 / 订单数（需新接 connector，1-2 天 + connector）
4. 📋 **A3 CTS/Oztop 案例沉淀** — 半天事，把跑通经验固化
5. 📋 **Phase 24.B** — GBP 数据摂取（依赖 GBP.0 + migration）

**ME 定位升级（2026-06-02 确立）**：
旧 → 营销自动化平台
**新 → 以 Goal 为中心的生意指挥平台**（Kanban 汇总所有能帮客户达成 Goal 的因素，营销只是其中一条战线）

下一 session：`继续 ME 工作 — 跑 Phase 33 P33.9/P33.10 + M4 测试` 或 `继续 ME 工作 — A3 案例沉淀`

**更新规则**（每次上线新功能）：
1. ROADMAP.md 勾选对应任务 checkbox
2. 更新本表（移除已完成，加入新任务）
3. 在 ROADMAP.md § 9 功能完成日志 追加一条记录
4. commit 引用 Phase ID：`feat(...): ... [P12.A.X]`
