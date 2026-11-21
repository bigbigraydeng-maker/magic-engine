# 广告智能体系：「动作请求 → 回执」追踪与回执表设计（v0.3，只设计，不写代码）

日期 2026-10-21 ｜ 起草：122 号（追踪与回执）｜ 要求方：74 号 ｜ 状态：草案 v0.3（已与 119 号设计稿 §6 对齐），待子牙 + 魏征设计审（74 派）+ PM 点头（新表 = A 级，apply 迁移要 PM 显式 go）
依据：74 号架构稿 `docs/specs/2026-10-21-ad-agent-system-v1-architecture.md`（提交 827a49654）§3 闭环、§5 W1、§7 分工里 122 那一行「回执表接新事件」；119 号 `docs/specs/2026-10-21-ad-agent-kernel-side-design-v0.3.md`（其 §6 是合同、请求表与本台账的分工；该稿目前在 119 的工作区，提交后以其分支为准）。
事实基于 `origin/main 755033c8e` 与 2026-10-21 对生产库的只读核对（核对项逐条写在 §2）。

## 变更记录
**v0.1 → v0.2（74 号 10-21 的三个条件 + 两处收窄）**
- (a) 事件前缀改 `ad_agent.*`（合同唯一权威是 119 的 `src/lib/ad-agent/contract`，子牙审定）；(b) 两张表分工写死，不重叠；(c) 平台字段中性命名，行业 / 客户词不进列名、枚举值、事件名；W1 验收只保留一条端到端链；「开投」并入（`launch`）。

**v0.2 → v0.3（与 119 号 v0.3 §6 对齐）**
- **请求状态 = 合同的八态**：`requested | accepted | pending_pm_approval | executing | fulfilled | rejected | expired | failed`。v0.2 里的 `approved / executed / completed …` 是**回执阶段**（事件动词），不是请求状态。阶段 → 状态的映射函数归合同（119，暂名 `statusAfterStage`），写入函数调用它，**调用方不自己传 status**；台账的 `status` 与阶段清单 CHECK 抄合同常量，单测对照，漂了就红（§1、§3、§5）。
- **`waiting_on` / `next_due_at` 回到台账**：119 的 `ad_agent_requests` 是窄表、没有这两列，按 v0.2 §11 的回退方案处理——每一跳写下「下一步该谁 / 最晚何时」，监督函数读最新一行（§3、§7）。
- **`fulfilled` 只能经 `markFulfilled`**：回读规则归合同，实现随本稿的写入函数一起落地（119 §11「随 122」）；写入函数置 `fulfilled` 之前先回读 `downstream_ref`，回读失败整笔拒绝；`launch` 例外（只观察）（§4）。
- **`valid_until`**：非终态请求过了 `valid_until`，监督函数追加 `expired` 回执（§7）。
- **`launch`**：119 已加入请求类型，**只观察、不执行**；launch 行由我的体检 / 盯盘函数创建，只承载阶段回执（§8）。
- **内核**：119 已确认 `triggered_by='agent'` + `triggered_by_ref` 能带（`src/lib/kernel/runner.ts:47-49`、落库 `201-202`，库 CHECK 允许 `agent`）（§2）。
- **W1 验收口径**与 119 §10 同一条：诊断 → creative 请求 → `execution_items`（经 `/execution` + `promo_ref`）→ 视频 Agent → 回执（本台账）→ T+7 对账（§8）。
- 两边迁移分开 PR、互不夹带；**119 的 `ad_agent_requests` 迁移先合并**（本表对它有外键）（§9）。

## 0. 一段话结论
1. **不重造。** 「谁授权 / 怎么执行 / 做到哪步 / 成本 / 校验」的系统记录仍是**内核**（`action_runs`、`authorization_decisions`、`action_run_steps`、视图 `kernel_action_lineage`）；盯盘 / 体检的运行回执仍是 `cron_run_logs`；请求本身仍归 119 的 `ad_agent_requests`。这三样一个字都不搬。
2. **只新增一张追加式「请求回执台账」`agent_request_receipts`**：一行 = 一条请求在某个阶段的回执（谁做的、状态、谁批的、成本、是不是只是草稿、授权引用、平台回执号、下一步谁 / 最晚何时）。W1 的链路页读「119 的请求表（请求是什么、当前状态）+ 这张表（每一步）」就能画出「从发出到有回执」。
3. **台账不复制别人的事实**：不存合同正文、不存请求类型、不存当前状态副本、不存内核的授权与步骤细节（只存指针 `source_ref`）。
4. **内核一行代码不改。** 请求编号借内核现成的 `triggered_by='agent'` + `triggered_by_ref` 带过去（119 已确认能带）。
5. **「没回执」要有人管**：复用我盯盘函数的做法，每小时扫一遍，过了 `next_due_at` 还没下一跳回执的请求 → 今日待办（what / how / href 三件套）。

## 1. 两张表的分工（一个事实一个家）
| 事实 | 唯一的家 | 谁写 |
|---|---|---|
| 请求是什么：`request_id`、`client_id`、`request_type`、`contract_version`、**合同正文 `contract`**、`idempotency_key`、`valid_until`、`created_by`、`created_at`、`downstream_ref`（请求级的总指向：`action_run_id` / `execution_item_id` / 工单 id，只放引用）| 119 的 `ad_agent_requests`（窄表）| 广告 Agent / 合同代码（119）|
| 当前到哪了：`status`（合同八态之一）、`updated_at` | 119 的 `ad_agent_requests`（是台账最新一行的**缓存**）| **只由 §4 的唯一写入函数更新**，和「追加回执」在同一事务里；其它任何代码不得写 `status`（两边各加全仓扫描测试）|
| 每一步发生了什么：事件名、这一跳之后的状态、谁做的、谁批的、成本、`no_publish`、授权引用、平台回执号、下一步谁 / 最晚何时、指针、一句话 | **本稿** `agent_request_receipts`（追加式）| 同一个唯一写入函数 |
| 授权理由、步骤产物、校验结果（内核管的那几跳）| 内核 `kernel_action_lineage` | 内核（不动）；台账只存 `source_ref.action_run_id` |
| 体检 / 盯盘 / 同步器 / 监督函数的运行回执 | `cron_run_logs`（不动）| 各 Inngest 函数；台账只存 `source_ref.run_log_id` |

**规则**：① 本表**不存**合同正文、请求类型、当前状态；119 的表**不存**回执、成本、批准人、`no_publish`、授权引用、平台回执号。② 本表的 `status` 是「这一跳之后」的历史值（转移日志），119 表的 `status` 是它的最新值缓存——两边取值**完全同一套**（合同八态），由合同常量单一定义。③ 缓存可重建：修复脚本按每个 `request_id` 取 `seq` 最大的一行回写索引。④ 状态与阶段（事件名）的清单是对合同 TS 常量的抄写，**单测对照合同常量，漂了就红**。⑤ 回执**阶段**（`issued / approved / executed / completed …`）不是请求**状态**，二者靠合同目录里的映射函数转换，台账不另发明终态。

## 2. 现有零件对照（我查了这几处，结论都是「复用」）
| 要的东西 | 已有什么（出处） | 这次怎么用 |
|---|---|---|
| 请求 → 授权 → 执行 → 校验 → 结果 的系统记录 | 内核：迁移 `20260808000003_me2_execution_kernel_v1.sql`；视图 `kernel_action_lineage`（~1563 行，goal→run→授权→步骤→校验→结果）；`src/lib/kernel/lineage.ts::loadActionLineage`；死信 / 待审 → 今日待办 `handoff.ts` | **复用，不动**。内核类的请求从这里钻取细节 |
| 生产现状 | 2026-10-21 只读：`action_runs` 只有 4 行（`ads.pause_campaign`×2、`page.apply_optimization_request`×1、`page.apply_cts_github_metadata_request`×1，全是人触发、全成功，最新 10-18）；`authorization_decisions` 6 行；客户策略表里 ads.* 的动作（每个动作 2 个客户各一条）是 auto_approve，page.* 的两个动作（各 1 个客户）是 require_approval | 内核已经在跑，但**还没有一条「agent 触发」的真实运行** |
| 请求编号的落点 | 119 已确认：`SubmitActionInput` 有 `triggeredBy` 与 `triggeredByRef?`（`runner.ts:47-49`），落库 `runner.ts:201-202`，`action_runs.triggered_by` 的库 CHECK 允许 `agent`。两点提醒：① `agent` / `schedule` 目前没有调用方目录围栏（只有 `human` 有，`boundaries.ts:280`），119 的 PR-2 会补，**本稿的只读同步器不受影响**；② `triggered_by_ref` 是自由文本、无外键，**同步器要容忍悬空引用** | `request_id` 放 `triggered_by_ref`，**不改内核** |
| 事件命名与形状 | `src/lib/inngest/ads-events.ts` 头注释：点分 `<域>.<对象>.<动词>`；事件只当叫醒铃，payload 只带 id，消费者回库读当前值；幂等事件 id 的写法 | 照此命名，域名 `ad_agent`（§5）；事件 id = 回执键 |
| 机器可读回执的写法 | 我的体检 / 盯盘：回执写 `cron_run_logs.summary`（任务名 `ads-tracking-preflight` / `ads-tracking-launch-watch`），同时发事件 `ads.tracking_preflight.checked`（事件 id = 回执号，重试不重复发）；只读函数回执恒 `no_publish: true`；读方（今日待办 `pm-todo/ads-tracking-preflight-items.ts`、推广计划看板 `marketing-plan/promo/gates.ts` ← `ads-tracking-preflight/load-receipt.ts`）**读回执，不现算** | 这套约定升格为所有 Agent 的阶段回执约定 |
| 素材类请求的下游 | 执行看板 `execution_items`（119 稿 §10：creative 请求只走 `execution_items` + `promo_ref`）；视频工厂工单 `content_work_orders`（出片机领取推进）| 工厂 / 看板自己的状态**不搬进台账**，只在 `source_ref` 里放 `execution_item_id` / `work_order_id` |
| 各域已有的回执表 | `youtube_publish_receipts` / `youtube_publish_authorizations`、`social_post_measurement_receipts`、`ads_autonomy_sync_receipts`、`gsc_*_fetch_receipts`、`me_conversion_audit` | 都是「一个域一张、字段各异、没有按请求串起来」，所以需要一张**跨域的链路台账**；域表不动，只在 `source_ref` 里指过去 |
| 其它 Agent 的回执口径 | 95 号 SEO Agent 设计稿 v0.2（`feat/seo-agent-design-v0-2`）：`seo_receipt` 状态 `answered / blocked / rejected / superseded`，请求幂等靠 119 请求表对 `request_id` 的唯一约束 | 各 Agent 的**域内**状态由各自合同定义；写进台账时按合同映射函数落到八态（§5）|
| 卡住 / 失败 → 人工任务 | `pm-todo/manual-items.ts`（what / how / href）、内核 `handoff.ts`、我的 `pushPostLaunchItems` | 「请求卡住」新增一种待办，沿用同一管道 |
| 最小回执字段 | `CLAUDE.md §3`「Inngest 工作流硬约束」：request id、client id、source record id、status、cost/provider 影响、no_publish / authorization 状态、created_at | 台账字段就是这一条的落库 |
| 新校验方式 | 内核 `VerificationMethod` 是**封闭枚举**（`types.ts` ~184 行），加新的要改内核（A 级）| **W1 不依赖新校验方式**：下游 Agent 自己出回执；`fulfilled` 靠 `markFulfilled` 回读（§4）|

## 3. 台账表（最小字段）
表名 `public.agent_request_receipts`，**追加式**（不 UPDATE、不 DELETE）。一行 = 一个阶段的回执。

| 字段 | 类型 | 说明 / 为什么要有 |
|---|---|---|
| `receipt_key` | text **PK** | `<request_id>:<event_name>:<attempt>`。重试 / 重复事件靠它去重，同时是 Inngest 事件 id |
| `request_id` | uuid，FK → `ad_agent_requests(request_id)` | 整条链的编号（74 要求）。回执不能先于请求存在 |
| `seq` | int | 链内序号，从 1 起；`unique(request_id, seq)`。排序只认它，不认时钟 |
| `event_name` | text | 74 要求。`ad_agent.request.<阶段动词>`，取值抄合同事件名常量（§5）|
| `client_id` | uuid | 74 要求。写入函数校验与请求表一致（可选：对 `(request_id, client_id)` 建复合 FK，要 119 的表给 `unique(request_id, client_id)`）|
| `status` | text | 74 要求。**这一跳之后**的请求状态（合同八态），由 `statusAfterStage` 算出，**不由调用方传** |
| `actor` | text | 这一跳谁写的：广告 Agent / 视频 Agent / 网站 Agent / SEO Agent / 内核 / 人 / 系统 |
| `waiting_on` | text | 这一跳之后下一步该谁做（卡住时找谁）；终态为 null |
| `next_due_at` | timestamptz | 下一步最晚何时；终态为 null。「卡住」= 非终态且 `next_due_at < now()` |
| `approved_by` | text | 74 要求。`policy:<策略编号>` 或 `human:<邮箱>`；阶段为「批准」时必填 |
| `authorization_ref` | text | 指向授权记录：`authorization_decisions:<id>`，或 PM 在计划页 / 对话里的批准记录 `<表>:<id>` |
| `no_publish` | boolean | 74 要求。草稿 / 内部动作 = true（默认）；真对外可见 / 花钱 = false |
| `cost_usd` | numeric ≥ 0 | 74 要求。本跳的 **API / 生成成本**，不含广告花费（广告花费只在 `ad_daily_insights`，和内核 §14 K4 同口径）|
| `provider_ref` | jsonb | 平台 / 下游回执号：平台对象 id、工单号、部署号 |
| `source_ref` | jsonb | 本跳产生 / 读到的指针：`{action_run_id, execution_item_id, work_order_id, run_log_id, …}`。**只放指针**；请求级总指向在 `ad_agent_requests.downstream_ref`，这里不重复存 |
| `note` | text | 一句话说人话，W1 直接显示 |
| `created_at` | timestamptz | 74 要求 |

（17 列：74 要的 8 项齐 + 9 项必要扩展 `receipt_key / seq / actor / waiting_on / next_due_at / authorization_ref / provider_ref / source_ref / note`，每项上表已写理由。）

**约束（把「没有授权和平台回执不许说做完」写进库，不靠自觉）**
1. `CHECK (event_name IN (<合同事件名常量>))`、`CHECK (status IN (<合同八态>))`——清单抄合同，单测对照，漂了就红。
2. `CHECK (NOT (event_name IN ('ad_agent.request.executed','ad_agent.request.completed') AND no_publish = false) OR (authorization_ref IS NOT NULL AND provider_ref IS NOT NULL))`：对外 / 花钱的阶段没有授权记录和平台回执，**写不进去**。
3. `CHECK (event_name <> 'ad_agent.request.approved' OR approved_by IS NOT NULL)`。
4. 追加式：不开 UPDATE / DELETE 的 RLS，再加一个拒绝 UPDATE / DELETE 的触发器（写法照内核 `authorization_decisions` 的不可变触发器，迁移 ~225 行）。
5. RLS 一律 service-role 模板：`FOR ALL TO service_role USING (true) WITH CHECK (true)`（`CLAUDE.md §7`，漏 `TO service_role` = 对匿名访客敞开）。
6. 索引：`unique(request_id, seq)`；`(client_id, created_at desc)`；另给一个只读视图 `agent_request_heads`（每条请求的最新一行回执，`distinct on (request_id) … order by seq desc`），监督函数和列表页读它——它不存数据，不构成第二个「当前状态」的家。

## 4. 唯一写入函数（原子，不靠自觉）
**入口只有一个**：TS 外壳 `appendAgentRequestReceipt()`（`src/lib/agent-requests/ledger.ts`）+ 它调用的一个 SQL 函数 `append_ad_agent_request_receipt(...)`（仅 service role 可调）。再加一条静态扫描测试：只允许 `ledger.ts` 往该表 `insert`、只允许该 SQL 函数写 `ad_agent_requests.status`（119 那边也加同样的扫描）。

TS 外壳依次做：
1. 校验阶段动词在合同常量里，用合同的 `statusAfterStage(阶段, 当前状态)` 算出这一跳之后的 `status`；校验 §3 的约束（报错说人话，不让库的 CHECK 报错裸奔），并**强制非终态阶段带 `waiting_on` 与 `next_due_at`**（终态才允许为 null，见 §10 ④）。
2. **若结果状态是 `fulfilled`（`completed` 阶段）且请求类型不是 `launch`**：先走合同里的 `markFulfilled` 回读规则——读 `ad_agent_requests.downstream_ref` 指向的记录，确认成功（`action_runs.status='succeeded'`，或工单 / `execution_items` 的终态成功）；**回读失败或 `downstream_ref` 为空 → 整笔拒绝**，不落任何东西。回读结果是单调的（succeeded 不会倒退），所以回读与写入之间的缝隙不会放过假成功；119 的表另加 CHECK：`status='fulfilled'` 必须有非空 `downstream_ref`。
3. 调 SQL 函数，**一个事务里**：① 锁住请求行（`FOR UPDATE`）；② 校验 `client_id` 一致、请求未处于终态（`fulfilled / rejected / expired / failed` 之后只允许追加「对账」这类不改状态的阶段）；③ `seq = 当前最大 + 1`；④ `insert` 回执，`receipt_key` 冲突 `do nothing` 并返回已有那行（幂等）；⑤ 把请求行的 `status / updated_at` 改成这条回执之后的值。
4. 发事件（事件 id = `receipt_key`，payload 只带 `{client_id, request_id, receipt_key}`）。

**写入方**（各自一次调用，不用懂表）：广告 Agent（发出 / 等批准）、视频 / 网站 / SEO Agent（接单 / 草稿 / 上线 / 失败）、对账任务（T+7、T+14）、监督函数（过期）。内核同步器与「开投」链见 §8，W1 不验收。

## 5. 事件名、阶段与状态
- 事件名：**`ad_agent.request.<阶段动词>`**（`<域>.<对象>.<动词>`，照 `ads-events.ts`），清单与常量由合同目录统一导出（119 写）。监督函数的人手叫醒事件：`ad_agent.request_watch.requested`。
- 下表是**草案示例**，只用来说明阶段与状态的对应；**阶段清单与 `statusAfterStage` 映射以 119 的合同为准**，合同落地后在下一版对照：

| 阶段动词 | 阶段含义 | 之后的请求状态（草案）| 谁发 | `no_publish` |
|---|---|---|---|---|
| `issued` | 请求已发出 | requested | 广告 Agent | true |
| `accepted` | 目标 Agent 接单（写工单号 / 执行项）| accepted | 目标 Agent | true |
| `delivered` | 草稿 / 变更包已出，待质检 / 待批 | 不变 | 目标 Agent | true |
| `approval_requested` | 等 PM 批准 | pending_pm_approval | 目标 Agent / 广告 Agent | true |
| `approved` | 批准（PM 或策略）| executing | 人 / 策略 | true |
| `rejected` | 驳回 | rejected | 人 | true |
| `executed` | 真上线 / 真改动 | 不变（executing）| 目标 Agent | **false**（必须带授权引用 + 平台回执号）|
| `completed` | 终态成功，附最终回执 | fulfilled（要过 `markFulfilled` 回读；`launch` 例外）| 目标 Agent | 同上 |
| `failed` | 失败 | failed | 任一方 | true |
| `expired` | 过了 `valid_until` 仍未终态 | expired | 监督函数 | true |
| `reconciled` | T+7 / T+14 对账：动了 / 没动 / 没测成（**不写因果**，结论放 `source_ref`）| 不变（fulfilled）| 对账任务 | true |

一条典型链（W1 要走通的那条，素材请求）：`issued`（requested）→ `accepted`（accepted，写工单号）→ `delivered`（两版草稿、成本，仍是 accepted）→ `approval_requested`（pending_pm_approval）→ `approved`（`human:`PM，executing）→ `executed`（真上线，平台回执号）→ `completed`（fulfilled，经 `markFulfilled`）→ `reconciled`（T+7，仍是 fulfilled）。

## 6. W1：「一条请求从发出到有回执」的链路怎么显示
读模型（不写库）——`src/lib/agent-requests/chain.ts`：
```ts
type RequestChain = {
  request_id: string; client_id: string; request_type: string      // 来自 ad_agent_requests
  state: 'in_progress' | 'waiting_approval' | 'stalled' | 'done' | 'failed' | 'rejected'
  headline: string                    // 一句话：现在到哪了、卡在谁手里、多久了
  hops: Array<{ seq: number; event_name: string; status: string; at: string; actor: string
                approved_by?: string; no_publish: boolean; cost_usd: number; note?: string
                provider_ref?: unknown }>
  waiting_on?: string; next_due_at?: string; overdue_hours?: number // 来自最新一行回执
  total_cost_usd: number
}
```
- `loadRequestChain(sb, requestId)`：读 `ad_agent_requests`（类型、当前状态）+ `agent_request_receipts`（每一跳）；有 `source_ref.action_run_id` 的那一跳点开才调内核 `loadActionLineage` 钻取（W1 不验收）。接口 `GET /api/admin/agent-requests/[request_id]`（管理员鉴权）。
- **展示由 105 号在推广计划页做**，读法照现在 `promo/facts.ts` 读我体检回执的方式（读回执，不现算）。每一跳一个点：已发出 → 已批准（谁、几点）→ 草稿已出（成本）→ 已上线（平台回执号）→ T+7 对账；`stalled` 的那一跳标红，写「卡在谁 / 已多久 / 该做什么」，带直达链接。
- 其它读方：119 稿 §7 的「启用前网站回执」闸（W2）读同一个读模型，要求链上有网站 Agent 的 `completed` 回执；缺回执 fail closed。

## 7. 「没回执」监督函数
- Inngest 函数 `ad-agent-request-watch`：每小时一次（新西兰 :35），事件 `ad_agent.request_watch.requested` 可人手叫醒。读 `ad_agent_requests`（状态非终态）联 `agent_request_heads`（最新一行回执）：
  - **卡住**：`next_due_at < now()` → `stalled`；
  - **过期**：过了 `valid_until` 仍非终态 → 经 §4 的唯一写入函数追加 `expired` 回执（`actor` = 系统），不绕过写入函数。
- 写法照我的盯盘：运行回执写 `cron_run_logs`（任务名 `ad-agent-request-watch`，`summary` = {checked, stalled:[request_id…], expired:[…]}）；`stalled` 的请求推一条今日待办：**what**（「某某请求已 N 小时没回执，卡在 谁」）/ **how**（具体点哪里、谁该做什么）/ **href**（W1 链路页直达）；同一请求同一状态一天一条，不刷屏。读不到请求表 = 函数自己失败（如实写 failed），不当成「没有卡住的」。
- 默认时限（写入者发回执时填 `next_due_at`，可按请求覆盖）：预算类批准后 2 小时 / 受众类 24 小时 / 素材类 72 小时出草稿、批准后 24 小时上线 / 页面类 48 小时 / SEO 类 7 天。
- 新 Inngest 函数合并后要有人对 `/api/inngest` 重新 Sync，不然「安静地不跑」。

## 8. W1 验收（只保留一条）与其余先设计不验收
**W1 验收（唯一一条端到端链，与 119 稿 §10 同一条）**：诊断 → creative 请求 → `execution_items`（经 `/execution` + `promo_ref`）→ 视频 Agent（第一个客户的素材，上海团）→ 回执（本台账）→ T+7 对账。**每一跳都有回执**（含成本、批准人、`no_publish`、平台回执号、下一步谁 / 最晚何时），W1 链路页能画出来；`completed` 过了 `markFulfilled` 回读；上线后的 **T+7** 出 `reconciled`（动了 / 没动 / 没测成）。没真实跑通不叫做好，单元测试绿不能代替这条。

**实现自带的测试（不算验收项，但合并前必须绿）**：
- 库里拦得住：造一条 `executed` + `no_publish=false` 但没有授权引用 / 平台回执号的回执 → 被 CHECK 拒绝（单测 + 当场对库试一次）。
- `markFulfilled`：`downstream_ref` 为空、或指向的记录不是成功态、或读取失败 → `completed` 被拒绝且库里什么都没变；`launch` 不走这条。
- 幂等：同一个事件重放两次 → 只有一行；缓存可重建：清掉请求行的 `status`，修复脚本按台账补回。
- 监督：造一条超时没下一跳的请求 → 一小时内出现一条三件套待办，补上回执后待办消失；造一条过了 `valid_until` 的请求 → 追加 `expired`。
- 清单对照：状态清单、阶段（事件名）清单对照合同常量（漂了就红）；只有 `ledger.ts` 能往该表 `insert`、只有写入函数能写 `ad_agent_requests.status`（静态扫描）。

**先设计、不验收（W1 之外）**：
- 其余请求类型（预算 / 受众 / 页面 / SEO）；它们写同一张表，规则不变，等 119 的合同与各 Agent 就绪再各走一条。
- **内核同步器**：Inngest 只读扫 `action_runs where triggered_by='agent' and triggered_by_ref is not null`，把内核状态变化翻译成台账回执（`authorization_ref = authorization_decisions:<id>`，`source_ref.action_run_id` 指回内核）；内核不改一行；**容忍悬空的 `triggered_by_ref`**（无外键）。
- **「开投」并入（`launch`）**：请求类型由 119 加入合同，**只观察、不执行**——不允许 Agent 创建能被执行器消费的 launch 请求（开投只认 PM 本人）；launch 行由我的体检 / 盯盘函数通过合同提供的「只允许 launch 的观察型创建入口」建立，只承载阶段回执（`no_publish=true`，`source_ref.run_log_id` 指回 `cron_run_logs` 那份完整回执）；`markFulfilled` 不适用，launch 的终态由我的回执置位。回填 CTS 10-20 开投那条链、回填内核那 4 条 run，等 W2。

## 9. 分工 / 风险级 / Tier
| 谁 | 交付 |
|---|---|
| 119 | 合同目录 `src/lib/ad-agent/contract/`（状态八态、阶段 / 事件名常量、`statusAfterStage`、`markFulfilled` 的回读规则、请求类型含 `launch`）+ `ad_agent_requests` 迁移；广告 Agent 发 `issued`。**合同目录现在还不存在**，等她的 v0.3 过审后才写 |
| 122（我）| 台账迁移（只随 PR，不在 PR 内 apply）、SQL 写入函数 + `ledger.ts`（含调用 `markFulfilled`）、`chain.ts` + 接口、`ad-agent-request-watch`、测试；DeepSeek 分轮写，我审 |
| 105 | 推广计划页的链路展示（读 §6 接口）|
| 106 / 121 / 95 | 各自流程里调写入函数发阶段回执 |
| 74 | 合同验收、W1 验收、与 PM 沟通 |
**PR 顺序**：两边迁移分开 PR、互不夹带；**119 的 `ad_agent_requests` 迁移与合同先合并**，本台账迁移排在后面（有外键）。
**风险级 A**：新表 + 新 SQL 写入函数 + 新 Inngest 函数 + 「对外动作没授权写不进去」「没回读成功不许置 fulfilled」的库内与函数内规则。子牙 + 魏征设计审一次、实施后一次；PM 回「合 N」才合并，apply 迁移另要 PM 显式 go。写代码默认 DeepSeek（`CLAUDE.md §5`）。
**Tier（Inline）**：归位 Kernel / Governance / Verification 基础设施，不新增支柱、不新增能力线；共享代码里不出现客户名 / 行业词（平台字段中性命名，119 稿用 `dimension_key` / `offer_ref`）；时限默认值是平台常量，个别请求的差异走 `next_due_at`。并入 74 稿里已登记的「素材智能」候选，不另登记。

## 10. 不做 / 残余风险
- **不做**：不改内核任何文件；不新增校验方式；不存广告花费；不替 119 定合同、状态机、阶段清单；不写 UI；不改 `cron_run_logs`；不回写任何广告平台。
- **残余风险**：① 缓存与台账漂移——唯一写入函数在一个事务里改两处 + 可重建脚本 + 单测兜底；② 写入函数被绕过——静态扫描测试 + 表上不开 UPDATE / DELETE；③ 状态 / 阶段清单抄写漂移——单测对照合同常量；④ `waiting_on / next_due_at` 在每跳都写一份「下一步承诺」，若写入方漏填，监督函数会把该请求当成「无时限」——所以写入函数对非终态阶段**强制要求这两项非空**（终态才允许 null）；⑤ 合同目录尚未落地，本稿的阶段 / 状态映射表是草案，合同落地后需对照一版（v0.4 或随实现 PR 的第一轮对照）。

## 11. 对齐记录与剩余待办
**119 号 10-21 的答复（已并入本稿）**：
1. `submitActionRun` 能带 `triggered_by='agent'` + `triggered_by_ref`（`runner.ts:47-49`、`201-202`；库 CHECK 允许 `agent`）；`agent` / `schedule` 的目录围栏由她的 PR-2 补；同步器容忍悬空引用。
2. `ad_agent_requests` 列：`request_id` PK、`client_id`、`request_type`、`status`、`contract_version`、`contract`、`idempotency_key`（unique）、`valid_until`、`created_by`、`created_at`、`updated_at`、`downstream_ref`；状态八态；请求类型 `budget | audience | creative | page | seo | launch`；合同路径 `src/lib/ad-agent/contract/` 尚不存在。
3. `launch` 只观察、不执行；索引表**不放** `waiting_on / next_due_at`（已回退到台账）。

**剩余待办**：
- (a) 合同目录落地后，对照阶段清单与 `statusAfterStage`，更新 §5 的草案映射。
- (b) launch 行的创建入口：由合同提供「只允许 launch 的观察型创建函数」，我的体检 / 盯盘函数调用——请 119 在合同里给出。
- (c) 可选：`ad_agent_requests` 加 `unique(request_id, client_id)`，台账对 `(request_id, client_id)` 建复合 FK。
- (d) `valid_until` 的默认值与「过期」语义（过期 = 追加 `expired` 回执）请 119 确认。
