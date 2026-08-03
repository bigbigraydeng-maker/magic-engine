# Magic Engine — 架构与业务决策记录

> 倒序。每条格式：**日期 · 决策 · 为什么 · 影响什么**。
> 只记「改变了后续做法」的决策；日常任务进度见 [ROADMAP.md](./ROADMAP.md)，已上线功能见 [history/CHANGELOG.md](./history/CHANGELOG.md)。
>
> 来源：原 `ROADMAP.md § 8 决策日志` + `CLAUDE.md` 内嵌 PM 拍板段 + git 提交记录。

---

## 2026-07-25 · 素材来源政策：不足就去全网抓

**决策**：素材不足不是借口。抓取优先级按**合规性**排（不是按方便程度）：① Unsplash / Pexels（免费商用，零风险，首选）② Apify 各类 scraper（Pinterest / IG / FB，用于找参考定风格）③ 客户自己上传的真实素材（质量最高、唯一能打真价）。加工链路：好看的图 →(i2v)→ 视频，或 图 →(图转图换风格)→ 再转视频。

**为什么**：PM 拍板「版权的事情不需要你考虑」，风险由 PM 承担，agent 不再反复请示。

**影响**：仍保留一条**客户利益**红线（非版权洁癖）——客户**真实产品 / 真实价格**的画面只能用客户自己提供的素材；抓来的图可做氛围，不能冒充客户产品。

## 2026-07-25 · 文档体系重构

**决策**：根目录只留 `CLAUDE.md` / `README.md` / `AGENTS.md`；其余全部进 `docs/`。新增 `STATE.md`（唯一真相源）/ `ENV.md` / `DECISIONS.md` / `PITFALLS.md`；`ROADMAP.md` 只留未完成；完成日志拆到 `history/CHANGELOG.md`。

**为什么**：审计发现 194 个 .md 里，`ARCHITECTURE.md` 停在 2026-05-23（列 45 个端点但实际 403 个、15 张表但实际 141 张）、`TESTING.md`/`QUICK_REFERENCE.md`/`PROJECT.md` 是前身项目 CrazyContent 的遗留、62 个在用环境变量无任何登记、7 个 cron 端点没有调度器。

**影响**：删 `TESTING.md` `QUICK_REFERENCE.md` `PROJECT.md` `DEPLOYMENT_RENDER.md`；`AUTOMATION_SPEC.md` `BILLING_TOKEN_SYSTEM.md` `PLATFORM_ARCHITECTURE.md` `MODULE_MAP.md` 归档；`docs/superpowers/specs/` 并入 `docs/specs/`；根 `clients/` 并入 `docs/clients/`。全量 ROADMAP 底稿保留在 `docs/archive/ROADMAP-full-2026-07-25.md`。

## 2026-07-21 · 高频 sweeper 降频

**决策**：`vision-analyzer` / `poll-visual-jobs` 从 `*/2` 降到 `*/10`；`zhangqian-sweeper` / `blog-stuck-generating-sweeper` 从 `*/5` 降到 `*/15`。

**为什么**：每日调用量下降 77%，成本与 Render cron 配额压力。

**影响**：commit `b9f8189`。`render.yaml` 内仍有一处注释写着 "every 2 minutes"（已修正）；任何引用旧频率的文档都是过时的。

## 2026-07-20 · 跟 PM 说话的格式

**决策**：一次只问一件事 · 问题必须一句话能回 · 零黑话 · 先结论再原因 · 技术选择题不塞给 PM。

**为什么**：Ad Strategy Engine spec 写完后一口气抛了 `go merge`、force-pause 守卫、migration `go apply`、P1-P5 阶段号，PM 直接回「看不懂你的问题」。改成「文档写完了，要不要现在合进系统？回 `go merge` 就行」之后立刻办了。

**影响**：写入 `CLAUDE.md`，对所有 agent 永久生效。

## 2026-07-13 · 客户对外内容必先 grounding 官网真实行程

**决策**：给客户写任何对外内容（reel / post / caption / 广告 / 邮件）前，必须先 WebFetch 客户官网真实产品/行程页。`master_briefs` 只给定位/受众/支柱，**不含真实运营细节**。发布前过一道 claim 审：逐句标「官网可溯 / brief 可溯 / 未证实」。

**为什么**：CTS 长城 reel 编了「日出登长城 / at DAWN」，官网真实行程是慕田峪 early start 全天、缆车上滑道下、无日出。PM 追问来源当场揭穿，已撤 Publer 排期。

**影响**：与「绝不凭空注入客户业务数据」是同一红线两面 —— 那条防编**数字**，这条防编**运营细节**。

## 2026-07-12 · GitHub Actions 定时 → Render Cron Scheduler

**决策**：`winner-reel-sync-daily` 的 schedule 从 GH Actions 移到 `render.yaml`，GH workflow 只保留 `workflow_dispatch` 手动触发。

**为什么**：GitHub Actions 的 scheduled run 是 best-effort，15:00 UTC 那次被静默跳过。

**影响**：新 cron 一律优先放 Render。目前只剩 `baseline-domains-monthly` / `goals-expiry-check` / `factory-worker-sweeper` 三个仍由 GH Actions 调度。

## 2026-07-11 · 遇卡点必自动化，人工兜底当作不存在

**决策**：第三方 UI 卡住 / API 未文档化 / 跨客户重复操作 —— agent 必须自己解决（深挖 UI 隐藏入口 → 官方 Graph API 直调 → 页面 context inject Ajax → DevTools 深度自动化 → 沉淀成 ME 产品能力）。绝不 handoff「请 PM / FDE / 客户老板去点某个按钮」。

**为什么**：CTS ThruPlay Pool Builder 加 4 个 winner Reel 时，Meta Ads Manager「使用现有帖子」没暴露 post 切换器，子牙 handoff「请 PM 手机 Business Suite boost」。PM 拍桌：「我不接受人工来做，考虑到未来的业务增长模型，还是需要自动化」。

**影响**：唯一例外仍是 ① 不可逆操作的 go-or-stop ② 客户真实业务场景 fact。

## 2026-07-11 · 图/视频引擎从 Higgsfield 切到 Muapi

**决策**：Content Factory 的图片与视频生成走 Muapi（`MODELSLAB_API_KEY`）。

**影响**：见 `docs/specs/2026-07-11-p21j-m2-muapi-spike.md`。

## 2026-06-13 · PM 角色边界

**决策**：PM 只决策业务 / 客户 / 钱 / 优先级 / 风险接受度。技术决策（分支策略、修复路径 A vs B、字段命名、测试覆盖、架构与接口契约）由子牙拍板 + 召其他 agent 复审，永不上抛 PM。

**为什么**：子牙一次抛了 4 个技术问题让 PM 挑，PM 拍桌「我无法回答，你给方案」。

**影响**：唯一例外 —— 不可逆操作（`gh pr merge` / `apply_migration` / `git push --force` / 删客户数据）必须 PM 显式 `go`。

## 2026-06-10 · 客户营销落地页必须建在客户自己的域名（红线）

**决策**：任何为客户做的对外营销页 / 销售页 / Lead 收集页，必须建在客户自己的域名下。**绝对禁止** `magicengine.com.au/<客户>/...` 这类 ME 域名子路径。

**为什么**：① 客户 SEO 权重必须积累在客户自己域名 ② 客户业务身份与 ME 身份严格隔离 ③ 客户老板看到自家活动页挂在供应商域名下会觉得品牌被绑架。子牙曾提议把 Oztop Walnut 清仓 LP 建在 `magicengine.com.au/oztop/walnut-clearance/`，PM 拍桌定为永久红线。

**影响**：实施路径改为 React/HTML mockup → Elementor Template JSON / WP 主题模板 → 客户侧 import → 表单 webhook 回调 ME API。ME 只做内部工作台 / Discovery 落地页 / 自家品牌页。

## 2026-06-08 · 核心引擎从 GIMPT 改为 DAPE

**决策**：ME 核心引擎重定义为 **DAPE** = Discovery → Analysis → Prescription → Execution 四段循环 + AI 贯穿全程 + 6 大支柱矩阵（SEO / 社媒 / 广告 / 口碑 / AI 可见度 / 竞品）。

**为什么**：原 GIMPT（Goal / Initiative / Marketing-plan / Prescription / Task 共 11 层）是早期工程师视角的层级堆叠，客户和 FDE 都讲不清。

**影响**：完整 spec `docs/specs/2026-06-08-me-dape-redefine-v0.2.md`（949 行，5-agent 签字）。**对外文案用大白话「发现-分析-处方-执行」，DAPE 字眼仅 ME 内部技术文档使用**（板桥强约束）。

## 2026-06-05 · Agent 审查协议

**决策**：大任务（触碰安全/隔离/鉴权 · 加表或改 schema · 新增对外 endpoint/UI · 跨多文件 >3 commit · 引入新依赖 · 影响已上线功能）必须 **子牙（架构）+ 魏征（挑刺）至少 2 审**；面向 C 端客户的**必须加板桥**；触碰隔离/安全核心的实施后**补狄仁杰**攻击验证。

**为什么**：一次把 6 个 P3 二期问题全堆给 PM，PM 回「看不懂」；事后魏征 + 板桥筛选只剩 3 个真商业决策。

**影响**：「我自己审过了」不算 2 审 —— 必须不同 agent。

## 2026-06-05 · 新表 migration 的 RLS 一律 service-role 模板

**决策**：新建表 migration 的 RLS policy 固定写法：`ENABLE ROW LEVEL SECURITY` + `CREATE POLICY "service_role_full" ... FOR ALL TO service_role USING (true)`（包在 `DO $$ ... EXCEPTION WHEN duplicate_object` 里）。禁止引用 `clients.workspace_id`（不存在）、`client_team`（不存在）、`auth.uid()` / `auth.jwt()`（ME 没用 Supabase Auth 做 end-user 鉴权）。

**为什么**：审计发现 13 处 schema 漂移（9 表未建 + 4 列缺失），根因是早期 migration 的 `CREATE POLICY` 引用了不存在的对象，apply 时炸在 policy 步骤、**整个事务回滚** —— 文件在仓里但 DB 里啥都没建。影响 19 客户关键词排名 cron 全瘫 + 5 个模块功能。

**影响**：写完 migration 必须 grep `workspace_id\|client_team\|auth\.uid\|auth\.jwt`，命中就重写。

> ### 🔴 2026-08-03 修正：`TO service_role` 不是可选项，漏了就是对外敞开
>
> **上面这条决策原本的模板漏了 `TO service_role`**，写成 `FOR ALL USING (true)`。
> Postgres 里 `CREATE POLICY` **不写 `TO` 子句 = `TO PUBLIC` = 对所有角色生效**，
> 包含 `anon`。而 Supabase 默认已给 `anon` / `authenticated` GRANT 了 public schema
> 下所有表的增删改查 —— 平时全靠 RLS 兜底，这个模板等于把兜底拆了。
>
> 策略名字叫 `service_role_full`，实际谁都能用。**名字骗了所有人两个月。**
>
> **实测**（2026-08-03，用生产环境公开 anon key —— 它随浏览器 bundle 公开分发）：
> 匿名可读 `outbound_prospects` 2,678 行、`conversation_messages` 2,135 行、
> `contact_identities` 1,260 行；匿名 `PATCH` 返回 204（可写）。
> 共 118 条策略中招（105 表全权限 + 10 INSERT + 2 UPDATE + 1 SELECT）。
> 未波及：第三方令牌、充值消费记录、客户账号表 —— 那几张的写法恰好是对的。
>
> 修复：`20260803020000_rls_lock_policies_to_service_role.sql`（用 `ALTER POLICY`
> 只改角色不动条件，无裸奔窗口）。
>
> **今后自查**：写完 migration 除了 grep 上面四个禁用对象，**再 grep 一次
> `FOR ALL USING`** —— 中间没有 `TO service_role` 就是这个洞。
> 或直接跑：
> ```sql
> select tablename, policyname from pg_policies
>  where schemaname='public' and roles::text='{public}'
>    and coalesce(qual,'true')='true' and coalesce(with_check,'true')='true';
> ```
> 除 `local_cities_read_all`（城市名参考数据，刻意公开）外应为空。

## 2026-06-02 · ME 定位升级

**决策**：从「营销自动化平台」→「**以 Goal 为中心的生意指挥平台**」。Kanban 汇总所有能帮客户达成 Goal 的因素，营销只是其中一条战线。

## 2026-05-27 · Phase 19 API 鉴权整改（IDOR）

**决策**：三层修复 —— L1 session-cookie 鉴权 + 移除 `NEXT_PUBLIC_INTERNAL_API_KEY`；L2 `requireClientAccess` per-client 授权 helper；L3 轮换 `INTERNAL_API_KEY`。

**为什么**：审计发现全部 89 个 `/api/clients/[id]/*` 路由系统性 IDOR，根因是 `INTERNAL_API_KEY` 经 `NEXT_PUBLIC_` 前缀编译进浏览器 bundle，约 33 个 dashboard 文件的 bearer-token 守卫虚设。

**影响**：硬约束 —— 19.A + 19.B 必须在给客户建员工登录账号之前完成（账号一建立，IDOR 即变外部攻击面）。已完成（PR #95）。

## 2026-05-19 · Phase 12.Q 内容质量闭环

**决策**：(1) **覆盖 Phase 13「campaign_briefs 不扩 schema」的决策**，加 6 个 nullable 字段（offer / target_audience_detail / proof_points / primary_cta / channel_goal / campaign_angle）；(2) quality rubric 走混合模式（规则可判维度走规则，质性维度走轻量 gpt-4o-mini），SDK client 由 route 注入、rubric 模块顶层不引用任何 SDK；(3) context snapshot 扩三张现有产物表，**不建 `production_packages` 聚合表**。

**为什么**：质量上限被 campaign context 缺失卡住，6 个 nullable 字段属低风险扩展。

## 2026-05-18 · SEMrush → DataForSEO 迁移

**决策**：现有 8 个 SEMrush 接口中 7 个可完整替换为 DataForSEO Labs 等效接口。

**为什么**：节省 96–99% 成本（SEMrush 按词计费 vs DataForSEO 按 task 计费）。数据质量相同（DataForSEO Labs 同源 SEMrush），唯一差异是 KD 算法口径不同，需在报告层注明。

**影响**：`src/app/api/semrush/` 已改名 `src/app/api/keyword-intelligence/`；`src/lib/semrush/` 已删除，入口改为 `src/lib/keywords/resolver.ts`。`SEMRUSH_API_KEY` 现已无代码读取（`render.yaml` 仍有声明，待清理）。**注意 `SEMRUSH_DB` 仍在用**（市场库标识 au/nz），不要一起删。

## 2026-05-17 · Phase 12 飞轮数据闭环启动

**决策**：
- 建 `flywheel_actions` / `flywheel_metrics` / `flywheel_outcomes` 三层数据骨架 + adapter 抽象
- **第 4 飞轮命名定为 `geo`**（替代历史命名 `insight_reports`）—— GEO 才是真正动手干活的引擎，月报独立为非飞轮的 `reports`
- 广告 vendor 策略：先用 Meta MCP 自建 adapter，markisfact 当「未来可插拔」备选。**硬约束 = 数据必须留在 ME 自己的表里，不管 vendor 是谁**
- 社媒飞轮形态 = 混合：自研内容制作（Atlas + OpenAI/Claude）+ 第三方发布（Publer）
- **AI Tracker 保留自建，不切 Apify `amernas/ai-brand-monitor`** —— 该 actor 不支持 AU/NZ 地域定位（默认美国视角，对全部客户失真），且状态 "Under maintenance" 不能做核心数据源
- **TikTok 广告库抓取未来用 Apify，不自建** —— 商品化数据采集，TikTok 反爬激进

**影响**：三种执行形态定为 `in_house` / `third_party` / `external_manual`；6 诊断维度不动，其中 `reputation` + `competitor` 只诊断不接飞轮。

## 2026-04-30 · 立项决策

- **三大核心**：SEO + GEO + 社媒内容矩阵；GEO 为 2026 Q2 核心差异化
- **商业模式**：年度陪跑服务（5–15 万/客户/年），不做 SaaS 月费
- **目标市场**：澳大利亚（AU）+ 新西兰（NZ）。所有功能必须默认 AU/NZ 上下文 —— 内容用 AU/NZ 英语拼写，时区 NZST/AEST，SERP 调用带 `gl=au`/`gl=nz`，AI Tracker 问句必须带地域标签
- **品牌封装**：客户可见层不暴露第三方真实供应商名（见 `CLAUDE.md`）

---

## 已作废的决策（别再按这些做）

| 原决策 | 何时作废 | 现在是什么 |
|---|---|---|
| **GIMPT 11 层引擎** | 2026-06-08 | DAPE 四段（见上） |
| **MLT（Magic Lab Token，$0.10 NZD）计费** | 被 Phase 20 取代 | **MTC**（Magic Token Coin），代码在 `src/lib/mtc/`。`MLT` 在 `src/` 中 0 引用。旧文档见 `archive/BILLING_TOKEN_SYSTEM.md` `archive/PLATFORM_ARCHITECTURE.md` |
| **Airtable × Zapier 自动化链路** | 逐步退役中 | Zapier 已完全不在代码里；Airtable 仅剩 3 处引用，审核已搬到 ME 驾驶舱 `/dashboard/factory`（PR #581）。旧 spec 见 `archive/AUTOMATION_SPEC.md` |
| **`magic-engine-tasks` background worker + `scripts/process-tasks.js`** | 2026-06-01 删除 | Render Cron Jobs（`render.yaml` 中 `type: cron`）。该端点从未真正实现过 |
| **部署推 `master` 分支** | — | 部署分支是 `main`。远程仍存在 `master` 分支，是历史遗留 |
| **Higgsfield 做图/视频引擎** | 2026-07-11 | Muapi（`MODELSLAB_API_KEY`） |
