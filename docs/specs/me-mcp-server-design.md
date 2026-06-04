# Magic Engine MCP Server 设计文档（客户自助数据访问）

> 状态：**设计稿 v2（已过魏征审查）** · 创建 2026-06-04 · 分支 `claude/magic-engine-mcp-design-GJNWq`
> 鉴权方向：**Per-client API Key**（PM 已拍板，OAuth 留作后期升级）
> 范围：**只读 MVP** — 客户在 Claude 里调用 MCP，查看「自己的」业务/营销数据

> **v2 修订（2026-06-04，采纳魏征审查）**：①新增 **T0 transport spike 前置关卡**——Streamable HTTP 套进 App Router route handler 存在 Node↔Web 签名不兼容风险，必须先验证（详见 §2.1 + §9）；②MVP tool 由 8 砍到 **5**（其余 3 个降为二期）；③补 zod/SDK 依赖盘点、空数据态语义、rate limit 改 Supabase 计数表；④工期 5 → **6–7 天**。坐标核验：魏征逐条读代码确认文档引用的表/字段/函数**全部真实存在、无编造**，CLAUDE.md 强约束**全部合规**。

---

## 0. 一句话目标

让客户在自己的 Claude（Desktop / 网页 Custom Connector）里接入 Magic Engine，用自然语言问「我这个月排名怎么样」「你们帮我做了什么」「我的目标进度如何」，由 Claude 调用 ME 的 MCP 工具拉取**该客户专属**的真实数据作答。**只读、强隔离、不暴露第三方供应商真名。**

---

## 1. 可行性结论

**技术上完全可行，且 ME 现状非常适合。** 本质上 MCP 要做的事 = 把现有「按 `client_id` 隔离的只读业务数据 + 成熟的 Next.js API」换一套**机器对机器的鉴权**后暴露给 Claude。

形态：**Remote MCP Server（Streamable HTTP transport），作为新路由 `/api/mcp` 挂在现有 Render 的 Next.js app 内**，零额外部署、零新基础设施。

### 现状盘点（为什么适合）

| 维度 | 现状（真实坐标） | 对 MCP 的意义 |
|------|------|--------------|
| 客户隔离键 | 所有业务表统一 `client_id` 外键，`ON DELETE CASCADE` | 隔离键天然存在，MCP 只需锁死一个 client_id |
| 权限表 | `client_portal_users(email, client_id, access_type)`，`access_type ∈ {portal, dashboard, both, self_serve, fde}` | 一身份可映射多客户，API Key 直接挂到 client_id |
| 现有鉴权 | `src/lib/auth/client-access.ts` → `requireDashboardClientAccess(clientId)`（基于 Supabase session cookie） | MCP 需一条**平行**鉴权 `requireApiKeyClientAccess()`，复用同一套 client_id 校验思路 |
| 数据丰度 | Goals / Initiatives / ExecutionItems / BlogPosts / ContentPosts / Keywords / GSC / GA4 / Flywheel / Diagnostic 全有 | 客户想自助查的数据基本都在 |
| API 模式 | `/api/clients/[id]/*` 统一成熟（如 `gsc/snapshots`、`ga4/snapshots`、`goals`） | MCP tool 直接复用 `src/lib` 查询逻辑，不重写 SQL |
| MCP 先例 | 团队已用 Meta Ads MCP（内部自动化），对 MCP 概念不陌生 | 降低团队理解成本 |

### 与现有鉴权的关键差异（必读）

现有所有 `/api/clients/[id]/*` 路由走 `requireDashboardClientAccess()` —— 它依赖**浏览器 Supabase session cookie**。MCP 是机器调用，**带不了 cookie**。因此不能直接复用这些路由，必须新增一条 **Bearer-token（API Key）鉴权链**。这是本设计的核心工作量来源。

> 注：部分 portal 路由文件头注释还写着 `Security: Bearer token (INTERNAL_API_KEY)`，那是 Phase 19.E 改造前的**历史注释漂移**，实际代码已是 session 鉴权。不要被注释误导。

---

## 2. 架构总览

```
客户的 Claude (Desktop / Web Custom Connector)
        │  Streamable HTTP + Authorization: Bearer me_live_xxx
        ▼
┌─────────────────────────────────────────────┐
│  Next.js app (Render, app.magicengine.com.au)│
│                                              │
│  POST /api/mcp   ← MCP transport endpoint    │
│    │                                         │
│    ├─ 1. requireApiKeyClientAccess(req)      │  ← 新增鉴权层
│    │      └─ hash(key) → client_api_keys     │     反查唯一 client_id
│    │           → 得到 clientId（强制注入）    │
│    │                                         │
│    ├─ 2. MCP Server (@modelcontextprotocol)  │
│    │      tools/list, tools/call             │
│    │                                         │
│    ├─ 3. tool handler → src/lib/* 查询        │  ← 复用现有 lib 查询
│    │      （永远用步骤1锁定的 clientId）       │     客户无法传别人的 id
│    │                                         │
│    └─ 4. vendorNameFilter(result)            │  ← 封装名过滤
│           OpenAI→Content Engine 等            │
│                                              │
│  supabaseAdmin (service-role)                │
└─────────────────────────────────────────────┘
```

**核心安全不变量**：`client_id` **永远由 API Key 反查得到，绝不接受工具入参传入**。这样即使 Claude（或恶意 prompt 注入）尝试传 `client_id`，也会被忽略，从根上杜绝越权。

### 2.1 ⚠️ 最大技术风险：transport 适配（魏征 🔴，必须 spike）

这是整个方案唯一可能翻船的地方，**不验证不许往下排期**：

- `@modelcontextprotocol/sdk` 的 `StreamableHTTPServerTransport` 期望 Node 原生 `http.IncomingMessage` / `ServerResponse`（Express 风格），而 **Next.js 14 App Router route handler 拿到的是 Web `Request` / `Response`**，两者签名不兼容。
- 两条出路，T0 spike 要拍定走哪条：
  1. **Stateless JSON 模式**（推荐 MVP）：transport 设为无 session、每个 POST 独立 request/response，牺牲服务端推送（SSE），但纯只读查询本来不需要推送 —— 最契合 App Router 的请求模型。
  2. **Web-stream 适配层**：自己写 `Request`↔`IncomingMessage` 的桥，支持 session + SSE，工作量大、风险高，MVP 不做。
- 若走 stateful/session 模式还需 **`GET /api/mcp` 维持 SSE 长连接** + session 生命周期管理（架构图当前只画了 POST）。Render `plan: standard` 是长驻单实例 Node（`next start`），**能撑长连接**——这点对方案有利，但仍需 spike 实证。

**结论**：MVP 默认走「stateless JSON」，T0 用 MCP Inspector 实测 route handler 能握手 + `tools/list` + 一次 `tools/call`，过了再排后面的 tool。

---

## 3. 鉴权设计（Per-client API Key）

### 3.1 新表 `client_api_keys`

迁移文件：`supabase/migrations/20260627000001_client_api_keys.sql`（命名沿用现有 `YYYYMMDD…` 格式）

```sql
CREATE TABLE IF NOT EXISTS client_api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  key_hash     text NOT NULL UNIQUE,        -- 只存 SHA-256，绝不存明文
  key_prefix   text NOT NULL,               -- 前 12 位明文，用于 UI 识别（me_live_a1b2…）
  name         text NOT NULL,               -- 客户给 key 起的名字
  scopes       text[] NOT NULL DEFAULT '{}',-- 预留：read:goals / read:seo …（MVP 全 read）
  created_by_email text,                     -- 创建者 email（审计，对齐 client_portal_users 既有列名）
  last_used_at timestamptz,
  revoked_at   timestamptz,                  -- 软删除：吊销不删行，保留审计
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_api_keys_client ON client_api_keys(client_id);
CREATE INDEX IF NOT EXISTS idx_client_api_keys_hash   ON client_api_keys(key_hash);

-- RLS：service_role 模板（CLAUDE.md 强约束，不引用 workspace_id / client_team / auth.uid）
ALTER TABLE client_api_keys ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON client_api_keys FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

### 3.2 Key 格式与生命周期

- 格式：`me_live_<32字节 base62 随机>`，明文**只在创建时返回一次**，之后无法找回。
- 入库：`key_hash = sha256(明文)`，`key_prefix = 明文前 12 位`（UI 显示 `me_live_a1b2…` + 末四位）。
- 吊销：写 `revoked_at`，不删行（保留 `last_used_at` 审计轨迹）。
- 校验：每次请求 `sha256(收到的 Bearer)` → 查 `key_hash` 且 `revoked_at IS NULL` → 拿到 `client_id`，顺手异步更新 `last_used_at`。

### 3.3 新鉴权函数 `requireApiKeyClientAccess`

新增 `src/lib/auth/api-key-access.ts`（与 `client-access.ts` 平行，互不污染）：

```ts
// 伪代码骨架
export async function requireApiKeyClientAccess(req: Request): Promise<
  | { ok: true; clientId: string; keyId: string }
  | { ok: false; status: 401; error: string }
> {
  const raw = extractBearer(req)                 // Authorization: Bearer me_live_…
  if (!raw) return { ok: false, status: 401, error: 'Missing API key' }
  const hash = sha256(raw)
  const { data } = await supabaseAdmin
    .from('client_api_keys')
    .select('id, client_id, revoked_at')
    .eq('key_hash', hash)
    .is('revoked_at', null)
    .maybeSingle()
  if (!data) return { ok: false, status: 401, error: 'Invalid API key' }
  void touchLastUsed(data.id)                    // fire-and-forget
  return { ok: true, clientId: data.client_id, keyId: data.id }
}
```

### 3.4 Key 管理 UI（强约束：必须有 UI）

CLAUDE.md 强约束「配置类数据必须有 UI，不能让 PM/FDE 进 Supabase 直填」对 API Key **同样适用**。因此 MVP **必须**包含：

- FDE/Dashboard 侧：客户设置抽屉新增「🔌 API 访问」标签 —— 列出该客户的 key（name / prefix / 最后使用 / 状态）+ 生成 + 吊销。
- 对称路由：`POST /api/clients/[id]/api-keys`（生成，仅此刻返回明文）、`GET`（列表，永不返回明文/hash）、`DELETE /api/clients/[id]/api-keys/[keyId]`（吊销）。这些路由本身走现有 `requireDashboardClientAccess()`（FDE 在浏览器里操作）。
- 复用现有 chip + 面板 pattern（参考 CMS 连接管理 Tab `P14.A.3`）。

> 客户自助生成 key 还是 FDE 代发？MVP 建议 **FDE 代发**（在 Dashboard 给客户生成后交付），降低初期滥用面；客户自助生成入口留到 portal 侧二期。见 §10 开放问题。

---

## 4. 工具集设计（MVP 5 个只读 + 二期 3 个）

所有 tool 都**不接受 client_id 入参**，client_id 由 API Key 锁定。schema 用 zod 定义（⚠️ zod 当前未安装，T0 需新增，见 §9），描述文案走封装名（见 §5）。

> 魏征 🟡：原 8 个对 MVP 偏多 —— 每个 tool 都要配回归测试 + 封装名过滤 + 空态，8 个会把测试任务撑爆。砍到覆盖客户三大原始诉求（「排名怎样 / 你们做了什么 / 目标进度」）的 **5 个核心**，其余 3 个降二期。

**MVP 5 个：**

| Tool | 入参 | 返回 | 复用的现有 lib/数据 |
|------|------|------|------|
| `me_get_overview` | — | 最新诊断总分 + 6 维度评分 + 内容交付计数 | `diagnostic_runs` / `blog_posts` / `content_posts` |
| `me_list_goals` | `status?` | 我的 Goal 列表 + 进度（baseline/target/current/verdict） | `goals`（+ A2.1 current_value） |
| `me_get_goal_detail` | `goal_id` | 单 Goal 详情 + execution-summary | `/api/goals/[goalId]/execution-summary` 逻辑 |
| `me_get_seo_performance` | `limit?` | GSC 快照（clicks/impressions/排名/top queries/pages） | `gsc_performance_snapshots` |
| `me_list_execution_items` | — | 正在为我执行的动作（按 6 维度分组） | `execution_items`（排除 skipped） |

**二期 3 个（地基稳了再加）：**

| Tool | 返回 | 注意 |
|------|------|------|
| `me_get_traffic` | GA4 快照（sessions / users / top sources） | ⚠️ `ga4_traffic_snapshots` 顶层**无独立转化字段**，转化埋在 `top_sources` JSONB 的 `{source, medium, sessions, conversions}` 里 —— tool 描述别误导成顶层字段 |
| `me_get_ai_visibility` | AI 搜索可见度（品牌被提及率趋势） | `flywheel_metrics`（`geo.*` 前缀）/ ai-tracker |
| `me_list_content` | 已交付博客 + 社媒内容清单 | `blog_posts` / `content_posts`（仅 published/approved） |

**空数据态语义（魏征 🟡，真实坑）**：GSC / GA4 / flywheel 表都是 cron 周期写入，**新接入客户这些表是空的**。每个 tool 必须显式区分「无权限/查不到」与「有权限但数据待同步」，后者返回结构化提示（如 `{ status: 'pending_sync', message: '数据每日同步，最新一批稍后可见' }`）而非空数组。空态进测试矩阵。

**显式不做（MVP）**：任何写操作 / Fix 执行 / 改预算改出价 —— 那是 FDE 权限边界（CLAUDE.md「Fix vs Talk to Us」），且 MCP 给客户的是**透明度**不是**控制权**。`reputation` / `competitor` 两维度按现有设计只读诊断，纳入 `me_get_overview` 评分但不单列工具。

---

## 5. 封装名过滤层（容易踩的坑 ⚠️）

MCP 返回给客户的内容 = **客户交付物**，受 CLAUDE.md「UI/报告/客户交付物禁止出现真实供应商名」约束。**tool 描述、字段名、返回值**里都不能出现真名。

新增 `src/lib/mcp/vendor-filter.ts`，返回前统一过滤：

| 真实服务 | 对客户暴露（封装名） |
|---------|----------------|
| OpenAI GPT-4o-mini | Content Engine |
| Anthropic Claude | Strategy Engine |
| SEMrush / DataForSEO | Keyword Intelligence |
| Jina.ai Reader | Site Analyzer |
| WaveSpeed / Seedance / HeyGen | Visual Studio / Video Studio / Avatar Studio |
| Airtable / Publer | Content Workspace / Publishing Hub |

具体要洗的字段举例：`blog_posts.model_used`、`keywords.source`（`semrush_*`）、`flywheel_metrics.source`（`semrush`）、任何 `vendor` 字段。**测试必须含一条「断言返回里 grep 不到真名」的回归用例。**

---

## 6. 安全设计

1. **越权防护（最重要）**：client_id 只从 API Key 反查，工具入参一律不接受 client_id。变异测试：故意让 tool 尝试读别的 client → 必须 0 行。
2. **只读**：MCP 路由只暴露 SELECT 类查询，不挂任何写 lib。
3. **Key 安全**：只存 hash；明文仅创建时返回一次；吊销软删保留审计。
4. **Rate limiting**：ME 应用层当前**完全没有** rate limit（探查确认，仅 site-audit 爬虫有节流）。MCP 对外，必须补 —— 按 `keyId` 滑动窗口（如 60 req/min）。**用 Supabase 计数表，不赌单实例内存 LRU**（魏征 🟡：Render 现在虽是单实例，但随时可能扩容，内存方案一扩就漏；对外暴露的 key，rate limit 不是「二期可选」项）。
5. **审计**：`last_used_at` + 可选 `mcp_access_log`（keyId / tool / ts），二期再加。
6. **最小返回**：每个 tool 只 select 客户该看的列，不 `select *`（避免泄露内部成本 `cost_usd`、internal flags 等）。
7. **统一错误契约 + 协议版本（魏征 🟢）**：T0 spike 拍定面向的 MCP protocol revision 并写入文档；所有 tool 抛错（DB 超时 / 客户未接 GSC / goal_id 不存在）返回统一结构（`isError: true` + 人话 message，封装名过滤后），不把原始堆栈/SQL 错误透给客户。

---

## 7. 客户接入体验（务实说明）

PM 选了 API Key 而非 OAuth，这里有个**真实的接入面权衡**，必须讲清楚：

- **Claude Desktop（MVP 首选）**：客户在 `claude_desktop_config.json` 用 `mcp-remote` 代理注入 header：
  ```json
  { "mcpServers": { "magic-engine": {
      "command": "npx",
      "args": ["mcp-remote", "https://app.magicengine.com.au/api/mcp",
               "--header", "Authorization: Bearer me_live_xxx"] } } }
  ```
- **claude.ai 网页版 Custom Connector**：网页版 Custom Connector 的最顺滑体验倾向 **OAuth**。纯 header API Key 在网页版接入不如 Desktop 顺。**因此：API Key = server 端最快落地 + Desktop 客户即可用；若要网页版一键 Connect，需二期加一层薄 OAuth 包装（API Key 当 client_secret）。** 见 §10。

我们随 key 一起给客户一份**一页接入 SOP**（放 `docs/sops/`），含上面的配置片段 + 截图。

---

## 8. 数据隔离验证

- 单测：两个 client 各发一个 key，A 的 key 调任何 tool 只能拿到 A 的数据。
- 变异测试：手动改坏「client_id 来自 key」这行，断言隔离测试立刻 fail（防空架子测试）。
- 边界：吊销的 key → 401；过期/不存在 key → 401；跨 client goal_id → 查不到（因为查询带 client_id 过滤）。

---

## 9. 分阶段实施计划（每任务一独立 commit）

| 任务 | 内容 | 验证 |
|------|------|------|
| **T0** ⭐ | **transport spike（前置关卡，不过不许往下）**：新增 `@modelcontextprotocol/sdk` + `zod` 并锁版本；用 stateless JSON 模式把 `StreamableHTTPServerTransport` 套进 `/api/mcp` route handler；MCP Inspector 实测握手 | `npm run build` 仍过 + Inspector 能 `tools/list` + 一次 `tools/call`（哪怕返回 stub） |
| **T1** | `client_api_keys` migration（service_role 模板，`created_by_email`）+ apply | Supabase 后台见新表 |
| **T2** | `src/lib/auth/api-key-access.ts` + key 生成/哈希工具 + 单测 | 单测：合法/吊销/无效 key |
| **T3** | Key 管理 API（`/api/clients/[id]/api-keys` GET/POST/DELETE） | 生成→列表→吊销闭环 |
| **T4** | Key 管理 UI（客户设置抽屉「🔌 API 访问」Tab） | FDE 能发 key（强约束：必须有 UI） |
| **T5** | `/api/mcp` 接 T0 transport + `requireApiKeyClientAccess` 鉴权挂载 | Inspector 带真实 key 能握手 |
| **T6** | 5 个只读 tool（复用 src/lib 查询）+ 空数据态 | 每 tool 真实 client 数据 + 空态回归 |
| **T7** | `vendor-filter.ts` + 「返回无真名」回归测试 | grep 真名 0 命中 |
| **T8** | Rate limit（Supabase 计数表，按 keyId）+ 隔离/变异测试 + 接入 SOP 文档 | 越权测试 0 行 |

**MVP 总估：≈ 6–7 个工作日**（魏征 🟡 上调，含 T0 spike 未知数 + T4 真实前端工作量）：T0 spike ~1d、T1–T4 鉴权地基+UI ~2.5d、T5–T6 MCP+5 工具 ~2d、T7–T8 安全+测试 ~1.5d。**T0 若发现需自写 Web-stream 适配层（非 stateless 能解决），立即回炉重估，不在此估算内。**

> 里程碑卡点（仿 Phase 12 风格）：
> - **M0 transport 通**：`npm run build` 通过（含新 SDK+zod 依赖）+ MCP Inspector 对 `/api/mcp` 握手成功（T0）—— **唯一可能让方案翻船的关卡，先过这关**
> - **M1 地基**：后台见 `client_api_keys` 表 + 鉴权单测过（T1–T3）
> - **M2 第一个 tool**：Inspector 用真实 key 调 `me_get_overview` 拿到真数据（T5–T6 部分）
> - **M3 端到端**：CTS 用真实 key 在 Claude Desktop 里问到自己的 SEO 数据，且返回无供应商真名（T6–T8）

---

## 10. Phase 归属与开放问题（待 PM 决策）

### 10.1 Phase 归属（不擅自新建，等 PM 拍）

按 CLAUDE.md「不要轻易新建 Phase」原则，候选：

- **选项 A（推荐）**：归入 **Phase 9（报告化 + 客户 Portal）** 作为子任务 `P9.3 Portal 程序化访问层（MCP）`。理由：MCP 本质是「客户 Portal」的程序化/对话式访问层，同模块延伸，已有 `P9.2 客户 Portal` 登记。
- **选项 B**：新建 Phase。理由：引入了**全新对外访问模态**（客户用 Claude 而非浏览器）+ 全新 API Key 基础设施 + 工作量达 8 任务，接近开新 Phase 门槛。但 CLAUDE.md 要求「PM 明确指示才开新 Phase」。

> 另注：ROADMAP `TD.3` 记着「Supabase MCP 未连接 ME 项目」——那是**给开发用的 Supabase 官方 MCP**，与本设计「给客户用的 ME 自研 MCP」是两回事，勿混淆。

### 10.2 开放问题

1. **Key 谁来发**：MVP FDE 代发 vs 客户 portal 自助生成？（建议先 FDE 代发）
2. **网页版接入**：是否需要二期 OAuth 薄层让 claude.ai 网页版一键 Connect？还是只支持 Desktop + mcp-remote 就够？
3. **工具粒度**：8 个够吗？是否要加 `me_get_monthly_report`（直接给月报摘要）？
4. ~~Rate limit 存储~~：**已拍定** —— Supabase 计数表（跨实例安全），不赌单实例内存（见 §6.4）。
5. **是否纳入计费**：API 调用是否消耗 MTC token / 计入 plan quota？（与 Phase 20 变现层关系）

---

## 11. 落地后 ROADMAP 登记草案（Phase 归属定了再写入）

```
- [ ] **P9.3.0** transport spike（前置关卡）：SDK+zod 依赖 + stateless StreamableHTTP 套进 App Router route handler + Inspector 握手
- [ ] **P9.3.1** client_api_keys 表 + Bearer 鉴权层（requireApiKeyClientAccess）
- [ ] **P9.3.2** Key 管理 API + 客户设置「🔌 API 访问」UI（强约束：配置类必须有 UI）
- [ ] **P9.3.3** /api/mcp 接 transport + 鉴权挂载
- [ ] **P9.3.4** 5 个只读 MCP tool（复用 src/lib 查询，client_id 由 key 锁定，含空数据态）
- [ ] **P9.3.5** 封装名过滤层 + Supabase 计数表 rate limit + 隔离/变异测试 + 客户接入 SOP
```

> ⚠️ 真正写入 ROADMAP.md 前，按 CLAUDE.md 强约束跑 `git diff main -- ROADMAP.md`，确认所有 `-` 删除行 100% 与本主题相关，防误删别 Phase 登记。
