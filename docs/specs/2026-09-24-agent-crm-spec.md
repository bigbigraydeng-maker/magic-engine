# CTS Agent 管理系统 — 开发规划

> **目标**：在 ME 后台建一个独立页面，用来管理旅行社（Agent）送来的客户进度，
> 支持高频邮件同步和直接回复邮件。
>
> **不是**：替代现有 CRM 看板（那个给散客用）、替代 GoHighLevel、替代 Messenger 模块。
>
> **写入者**：DeepSeek（通过 aider，在独立 worktree）
>
> **风险级别**：B（普通业务逻辑 + 新页面 + 不碰安全/隔离/migration）

---

## 0. 已有基础设施（不需要重建）

| 模块 | 路径 | 现状 |
|---|---|---|
| Microsoft 邮件读取 | `src/lib/microsoft/mail-graph.ts` | ✅ 读 CTS info@ 收件箱 + 已发送，每小时同步 |
| 邮件回复 | `src/lib/microsoft/mail-send.ts` | ✅ 已建好，用 Graph createReply + send 两步法 |
| OAuth scope | `src/lib/microsoft/mail-oauth.ts` | ✅ 已包含 Mail.Send |
| 邮件线程分类 | `src/lib/microsoft/mail-ingest.ts` | ✅ 按 conversationId 归线程、判方向、过滤机器人 |
| 联系人模型 | `contacts` + `contact_identities` 表 | ✅ 已有 display_name / primary_email / primary_phone |
| 联系人分类 | `src/lib/crm/contact-kind.ts` | ✅ `ContactKind = 'retail' | 'trade' | 'staff'`，按域名自动判 |
| 同行域名配置 | `clients.leads_config.trade_domains` | ✅ CTS 已配置 hot.co.nz 等 14+ 个域名 |
| 触点记录 | `contact_touchpoints` 表 | ✅ 每封邮件存 subject + body + direction |
| 会话模型 | `conversations` 表 | ✅ 按 conversationId 归组 |
| 每小时同步定时任务 | `/api/cron/mailbox-sync` | ✅ 在跑 |
| CRM 看板 UI 模式 | `/dashboard/clients/[id]/crm/page.tsx` | ✅ 有完整的抽屉、快捷笔记、邮件回复组件 |

**结论：建 Agent 管理系统不需要建新的数据管道，只需要在已有数据上加一个视图层 + 少量数据模型扩展。**

---

## 1. 数据模型扩展

### 1.1 Agent 与终端客户的关系

**核心问题**：现有 `contacts` 表里，House of Travel 的 Alex 是一个 `kind='trade'` 的 contact。Alex 代客户 Chris Brown 发邮件订团 —— 但 Chris Brown 不一定是 `contacts` 表里的人（他没有直接发过邮件）。

**方案**：加一张关系表 `agent_customers`，把 agent（trade contact）和他送来的终端客户关联起来。

```sql
-- agent_customers — 旅行社（Agent）送来的客户
CREATE TABLE IF NOT EXISTS agent_customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- 哪个 Agent（指向 contacts 表里 kind='trade' 的那个人）
  agent_contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,

  -- 终端客户信息（从邮件正文 AI 提取）
  customer_name   TEXT,
  pax             INTEGER,          -- 几个人
  trip_type       TEXT,             -- 团型（如 "China Panorama 17D"）
  travel_dates    TEXT,             -- 出发日期（原文，如 "March 2027"）
  specific_needs  TEXT,             -- 特殊需求

  -- 进度管理
  stage           TEXT NOT NULL DEFAULT 'new'
                  CHECK (stage IN (
                    'new',          -- 刚收到询价
                    'quoting',      -- 正在报价
                    'quoted',       -- 已报价，等回复
                    'confirmed',    -- 已确认
                    'deposit_paid', -- 已付定金
                    'completed',    -- 已出行
                    'lost'          -- 流失
                  )),

  -- 最后一次联系
  last_contact_at   TIMESTAMPTZ,
  last_contact_summary TEXT,        -- 最近一封邮件摘要

  -- 关联到邮件线程（可选，方便跳转看完整对话）
  conversation_id   UUID REFERENCES conversations(id),

  notes           TEXT,             -- FDE 手写备注

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 一个 Agent 送来的客户按最后联系时间排
CREATE INDEX IF NOT EXISTS agent_customers_agent_idx
  ON agent_customers (agent_contact_id, last_contact_at DESC);

-- 按 client 查全部 agent 客户
CREATE INDEX IF NOT EXISTS agent_customers_client_idx
  ON agent_customers (client_id, last_contact_at DESC);

-- RLS: service_role only
ALTER TABLE agent_customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_customers_service
  ON agent_customers FOR ALL TO service_role USING (true);
```

### 1.2 不需要改的表

- `contacts` — 不改。Agent 本身已经是 `kind='trade'` 的 contact。
- `contact_touchpoints` — 不改。邮件已经在里面了。
- `conversations` — 不改。邮件线程已经在里面了。

---

## 2. AI 提取：从邮件正文提取客户信息

**触发时机**：邮件同步 `mail-ingest.ts` 写入新触点后，如果这封邮件的 contact 是 `kind='trade'`，触发 AI 提取。

**提取逻辑**（新文件 `src/lib/crm/agent-customer-extract.ts`）：

```typescript
interface ExtractedCustomer {
  customerName: string | null
  pax: number | null
  tripType: string | null
  travelDates: string | null
  specificNeeds: string | null
}
```

**AI prompt 输入**：邮件 subject + bodyPreview（mail-graph 只拿 preview，不拿全文）。

**AI prompt 要求**：
1. 从邮件中提取：终端客户姓名、人数、想去哪条线、出发日期、特殊需求
2. 如果邮件是 Agent 回复询价（而非首次询价），只提取新增/变更的信息
3. 如果邮件内容跟客户订团无关（如发票、行政沟通），返回 null

**写入规则**：
- 首次出现的客户名 → 新建 `agent_customers` 行
- 已有客户名 + 同一个 Agent → 更新 `last_contact_at` 和 `last_contact_summary`
- 一封邮件可能提到多个客户（Agent 经常一封邮件问好几个客人的事）

**判重**：按 `agent_contact_id` + `customer_name`（模糊匹配，考虑 "Chris" vs "Christine Brown"）。首版用精确匹配 + 人工修正，不要过度工程化。

---

## 3. 页面设计

### 3.1 路由

```
/dashboard/clients/[id]/agents/page.tsx
```

**独立页面**，不跟现有 CRM 混在一起。在客户侧边栏加一个入口「🤝 同行渠道」。

### 3.2 页面结构

页面分两个视角，用 Tab 切换：

**Tab 1：按 Agent 看**（默认）

```
┌─ House of Travel (Auckland) ──────────────────────────────┐
│  Alex Chen  alex@hot.co.nz                                │
│  最后联系：2 天前                                           │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Chris Brown (2人) — China Panorama 17D — March 2027 │  │
│  │ 阶段：已报价 │ 最后：9/22 发了报价单               │  │
│  ├──────────────────────────────────────────────────────┤  │
│  │ Isaac Family (4人) — Silk Road 21D — Jan 2027       │  │
│  │ 阶段：等回复 │ 最后：9/20 客人说要跟家人商量       │  │
│  └──────────────────────────────────────────────────────┘  │
├────────────────────────────────────────────────────────────┤
│  Helloworld (Bay of Plenty)                                │
│  Sandy Yates  sandy@travel.helloworld.co.nz               │
│  ...                                                       │
└────────────────────────────────────────────────────────────┘
```

**Tab 2：按阶段看**（类似看板）

```
新询价(3)  │  报价中(2)  │  已报价(5)  │  已确认(1)  │  已付定(0)
───────────┼─────────────┼─────────────┼─────────────┼──────────
Chris/HoT  │ Sandy/HW    │ John/Orbit  │ Wei/TM      │
Lin/HoT    │ Lee/Asia    │ ...         │             │
Mike/Orbit │             │             │             │
```

### 3.3 交互

1. **点击客户卡片** → 右侧抽屉滑出，显示：
   - 客户信息（姓名、人数、线路、日期、需求）
   - 完整邮件时间线（复用 `ContactTimeline` 组件）
   - 阶段推进按钮（new → quoting → quoted → confirmed → ...）
   - 备注输入框

2. **回复邮件** → 抽屉里的「回复」按钮，调用已有的 `mail-send.ts`
   - 复用 `ComposeNote` 组件的邮件编辑模式
   - 回复的是 Agent 那条邮件线程（不是终端客户）

3. **手动新增客户** → Agent 卡片上的「+ 添加客户」按钮
   - 有时候 Agent 打电话报客户，不一定走邮件

### 3.4 同步状态指示

页面顶部显示：
- 最后同步时间（从 `mailbox-sync` 心跳读）
- 同步状态（正常 / 延迟 / 断连）
- 如果 Microsoft token 断了，显示重连按钮

---

## 4. API

### 4.1 新增 API 路由

```
GET  /api/clients/[id]/agents              — 查全部 Agent + 他们的客户
GET  /api/clients/[id]/agents/[agentId]    — 查单个 Agent 的详情 + 客户列表
POST /api/clients/[id]/agents/customers    — 手动新增 Agent 客户
PATCH /api/clients/[id]/agents/customers/[customerId]  — 更新阶段/备注
POST /api/clients/[id]/agents/reply        — 回复 Agent 邮件（调 mail-send）
```

### 4.2 鉴权

用已有的 `requirePaidClientAccess`（跟 CRM 看板一致）。

---

## 5. 邮件同步增强

### 5.1 当前同步频率

每小时一次（`/api/cron/mailbox-sync`），对 Agent 管理来说够用。

**不要改同步频率。** Agent 的邮件节奏是按天计的（一个 Agent 一天最多 2-3 封），每小时同步绰绰有余。

### 5.2 新增：同步后触发 AI 提取

在 `mail-ingest.ts` 的 `persistThreadBatch` 之后，加一个 hook：

```typescript
// 如果这个 contact 是 trade（同行），触发 AI 提取客户信息
if (contactKind === 'trade') {
  await extractAgentCustomers(clientId, contactId, newTouchpoints)
}
```

这是本任务唯一需要改已有文件的地方。改动最小化：只加一个 if + 函数调用。

---

## 6. 实现分工

### DeepSeek 负责开发（按顺序）

| 步骤 | 内容 | 新文件 | 改文件 |
|---|---|---|---|
| 1 | 建 `agent_customers` 表 migration | `supabase/migrations/2026XXXX_agent_customers.sql` | 无 |
| 2 | AI 提取模块 | `src/lib/crm/agent-customer-extract.ts` | 无 |
| 3 | 在邮件同步后触发提取 | 无 | `src/lib/microsoft/mail-ingest.ts`（加 ~10 行） |
| 4 | Agent 列表 API | `src/app/api/clients/[id]/agents/route.ts` | 无 |
| 5 | Agent 客户 CRUD API | `src/app/api/clients/[id]/agents/customers/route.ts` | 无 |
| 6 | 邮件回复 API | `src/app/api/clients/[id]/agents/reply/route.ts` | 无 |
| 7 | Agent 页面 | `src/app/dashboard/clients/[id]/agents/page.tsx` | `layout.tsx`（加侧边栏入口） |
| 8 | 抽屉组件 | `src/app/dashboard/clients/[id]/agents/_components/` | 无 |

### 复用已有组件（不要重写）

- `ContactTimeline` — 邮件时间线
- `ComposeNote` — 邮件编辑
- `PersonDrawer` 的交互模式 — 右侧抽屉
- `contactKindOf` — Agent 判定
- `mail-send.ts` — 邮件发送
- `requirePaidClientAccess` — 鉴权

### Claude Code 负责（统筹/复审）

- 本规划文档
- 复审 DeepSeek 的 PR
- 子牙架构复审（因为碰了 `mail-ingest.ts`）

---

## 7. 不做的事情（明确排除）

1. **不改同步频率** — Agent 邮件节奏按天，每小时够
2. **不改 contacts 表结构** — Agent 已经是 `kind='trade'`
3. **不做 Agent 自动识别** — 域名规则已经够用，不需要 AI 分类
4. **不做终端客户合并** — 一个 Agent 说 "Chris" 和 "Christine Brown" 是不是同一个人，首版让人判
5. **不做推送通知** — 首版看页面就行
6. **不跟 GoHighLevel 对接** — 那是 CTS 的 CRM，不是 ME 的功能
7. **不做群发** — Agent 是一个个谈的，不是群发的

---

## 8. 验收条件

1. 打开 `/dashboard/clients/CTS_ID/agents`，能看到按 Agent 分组的客户列表
2. 每个客户有：姓名、人数、线路、日期、当前阶段
3. 点击客户能看到完整邮件往来
4. 能在页面上直接回复 Agent 的邮件
5. 新邮件进来后（下一次同步），自动提取出客户信息并更新
6. 能手动修改客户阶段
7. 能手动添加客户（Agent 打电话来的情况）

---

## 9. DeepSeek 执行须知

### 环境准备

```bash
# 1. 建 worktree
cd /Users/raydeng/Projects/magic-engine
git worktree add .claude/worktrees/agent-crm feat/agent-crm -b feat/agent-crm

# 2. 复制环境文件
cp .env.local .claude/worktrees/agent-crm/.env.local

# 3. 进入 worktree
cd .claude/worktrees/agent-crm
```

### 必读文件

1. `CLAUDE.md` — 项目全局规则
2. `src/lib/crm/contact-kind.ts` — 理解 trade 分类
3. `src/lib/microsoft/mail-ingest.ts` — 理解邮件同步流程（**只改这一个已有文件**）
4. `src/lib/microsoft/mail-send.ts` — 理解邮件回复
5. `src/app/dashboard/clients/[id]/crm/page.tsx` — 理解 CRM 页面模式
6. 本文件 — 执行规划

### 铁律

- **RLS 必须写 `FOR ALL TO service_role USING (true)`**，不能漏 `TO service_role`
- **SDK 客户端在 handler 内初始化**，不在模块顶层
- **改 `mail-ingest.ts` 只加 hook 调用**，不重构、不改已有逻辑
- 新增 API 路由用 `requirePaidClientAccess` 鉴权
- TypeScript strict，不加 `any`

---

## 10. Reuse Statement

| 维度 | 内容 |
|---|---|
| 复用的平台能力 | `mail-graph` 邮件读取、`mail-send` 邮件回复、`mail-ingest` 邮件同步、`contacts` + `contact_touchpoints` 数据模型、`contactKindOf` 分类器、CRM 页面组件（Timeline / Drawer / ComposeNote） |
| 新增 platform-shared | `agent_customers` 关系表（任何客户都可以有 trade contact → 终端客户的关系）、AI 提取框架（从邮件正文提取结构化信息） |
| 新增 industry-specific | 旅游行业的阶段定义（new → quoting → quoted → confirmed → deposit_paid → completed → lost）应进入 Industry Profile，不硬编码 |
| 新增 client-specific | 无 |
| 客户名/ID 是否进 shared runtime | 否。CTS client_id 只在数据库行里，代码层面全部用 `clientId` 参数化 |
