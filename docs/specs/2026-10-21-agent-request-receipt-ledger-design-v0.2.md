# 广告智能体系：「动作请求 → 回执」追踪与回执表设计（v0.2，只设计，不写代码）

日期 2026-10-21 ｜ 起草：122 号（追踪与回执）｜ 要求方：74 号 ｜ 状态：草案 v0.2，待子牙 + 魏征设计审（74 派）+ PM 点头（新表 = A 级，apply 迁移要 PM 显式 go）
依据：`docs/specs/2026-10-21-ad-agent-system-v1-architecture.md`（74 号，提交 827a49654）§3 闭环、§5 W1、§7 分工里 122 那一行「回执表接新事件」。
事实基于 `origin/main 755033c8e` 与 2026-10-21 对生产库的只读核对（核对项逐条写在 §2）。

## v0.1 → v0.2 变更（74 号 10-21 的三个条件 + 两处收窄）
- **(a) 事件前缀改 `ad_agent.*`**：请求合同的唯一权威是 119 号的 `src/lib/ad-agent/contract`（子牙审定），不再用 `ads.agent_request.*`。
- **(b) 两张表分工写死，不重叠**：119 的 `ad_agent_requests` 只做「请求是什么 + 当前状态」的**索引**；本稿的 `agent_request_receipts` 只做**追加式阶段回执**。一个事实一个家，见 §1。台账因此**去掉** v0.1 的 `payload`、`request_type`、`agent_requests_current` 视图；**状态机用 119 的**（含 `pending_pm_approval`），本稿不另立状态枚举。
- **(c) 中性命名**：平台字段（列名、枚举值、事件名、函数名）里不出现行业 / 客户词（团、航班、楼盘、客户名）；行业差异只进请求合同正文和客户配置。
- **W1 验收只保留一条端到端链**（素材请求 → 回执 → T+7）；其余请求类型、内核同步器、「开投」并入先设计、不验收，见 §8。
- 「开投」并入台账当 `launch` 类：74 同意；是否需要 119 在合同枚举里加这个值，见 §11。

## 0. 一段话结论
1. **不重造。** 「谁授权 / 怎么执行 / 做到哪步 / 成本 / 校验」的系统记录仍是**内核**（`action_runs`、`authorization_decisions`、`action_run_steps`、视图 `kernel_action_lineage`）；盯盘 / 体检的运行回执仍是 `cron_run_logs`；119 的 `ad_agent_requests` 仍管请求本身。这三样一个字都不搬。
2. **只新增一张追加式「请求回执台账」`agent_request_receipts`**：一行 = 一条请求在某个阶段的回执（谁做的、状态、谁批的、成本、是不是只是草稿、授权引用、平台回执号）。W1 的链路页读「119 的索引（当前到哪）+ 这张表（每一步）」就能画出「从发出到有回执」。
3. **台账不复制别人的事实**：不存合同正文、不存当前状态副本、不存内核的授权与步骤细节（只存指针 `source_ref`）。
4. **内核一行代码不改。** 请求编号借内核现成的 `triggered_by='agent'` + `triggered_by_ref` 带过去（待 119 确认，§11）。
5. **「没回执」要有人管**：复用我盯盘函数的做法，每小时扫一遍，过了 `next_due_at` 还没下一跳回执的请求 → 今日待办（what / how / href 三件套）。

## 1. 两张表的分工（一个事实一个家）
| 事实 | 唯一的家 | 谁写 |
|---|---|---|
| 请求是什么：`request_id`、`client_id`、请求类型、合同版本、**合同正文**、请求时的证据 | 119 的 `ad_agent_requests` | 广告 Agent（119）发请求时写，之后不改 |
| 当前到哪了：`status`（**119 的状态机**，含 `pending_pm_approval`）、`waiting_on`、`next_due_at`、`updated_at` | 119 的 `ad_agent_requests`（是台账最新一行的**缓存**）| **只由 §4 的唯一写入函数更新**，和「追加回执」在同一事务里 |
| 每一步发生了什么：事件名、这一跳之后的状态、谁做的、谁批的、成本、`no_publish`、授权引用、平台回执号、指针、一句话 | **本稿** `agent_request_receipts`（追加式）| 同一个唯一写入函数 |
| 授权理由、步骤产物、校验结果（内核管的那几跳）| 内核 `kernel_action_lineage` | 内核（不动）；台账只存 `source_ref.action_run_id` |
| 体检 / 盯盘 / 同步器 / 监督函数的运行回执 | `cron_run_logs`（不动）| 各 Inngest 函数；台账只存 `source_ref.run_log_id` |

**规则**：① 本表**不存**合同正文、请求类型、当前状态；119 的表**不存**成本、批准人、`no_publish`、授权引用、平台回执号。② 本表的 `status` 是「这一跳之后」的历史值（转移日志），119 表的 `status` 是它的最新值缓存——两边的状态**名字完全相同**，由合同枚举单一定义。③ 缓存可重建：修复脚本按每个 `request_id` 取 `seq` 最大的一行回写索引。④ 状态枚举的迁移清单是对合同 TS 枚举的抄写，**单测对照合同枚举，漂了就红**。

## 2. 现有零件对照（我查了这几处，结论都是「复用」）
| 要的东西 | 已有什么（出处） | 这次怎么用 |
|---|---|---|
| 请求 → 授权 → 执行 → 校验 → 结果 的系统记录 | 内核：迁移 `20260808000003_me2_execution_kernel_v1.sql`；视图 `kernel_action_lineage`（~1563 行，goal→run→授权→步骤→校验→结果）；`src/lib/kernel/lineage.ts::loadActionLineage`；死信 / 待审 → 今日待办 `handoff.ts` | **复用，不动**。内核类的请求从这里钻取细节 |
| 生产现状 | 2026-10-21 只读：`action_runs` 只有 4 行（`ads.pause_campaign`×2、`page.apply_optimization_request`×1、`page.apply_cts_github_metadata_request`×1，全是人触发、全成功，最新 10-18）；`authorization_decisions` 6 行；客户策略表里 ads.* 的动作（每个动作 2 个客户各一条）是 auto_approve，page.* 的两个动作（各 1 个客户）是 require_approval | 内核已经在跑，但**还没有一条「agent 触发」的真实运行** |
| 请求编号的落点 | `action_runs.triggered_by`（可取 `'agent'`）+ `triggered_by_ref`（`types.ts` 62、380–381 行）| `request_id` 放 `triggered_by_ref`，**不改内核**（待 119 确认）|
| 事件命名与形状 | `src/lib/inngest/ads-events.ts` 头注释：点分 `<域>.<对象>.<动词>`；事件只当叫醒铃，payload 只带 id，消费者回库读当前值；幂等事件 id 的写法 | 照此命名，域名改 `ad_agent`（§5）；事件 id = 回执键 |
| 机器可读回执的写法 | 我的体检 / 盯盘：回执写 `cron_run_logs.summary`（任务名 `ads-tracking-preflight` / `ads-tracking-launch-watch`），同时发事件 `ads.tracking_preflight.checked`（事件 id = 回执号，重试不重复发）；只读函数回执恒 `no_publish: true`；读方（今日待办 `pm-todo/ads-tracking-preflight-items.ts`、推广计划看板 `marketing-plan/promo/gates.ts` ← `ads-tracking-preflight/load-receipt.ts`）**读回执，不现算** | 这套约定升格为所有 Agent 的阶段回执约定 |
| 各域已有的回执表 | `youtube_publish_receipts` / `youtube_publish_authorizations`、`social_post_measurement_receipts`、`ads_autonomy_sync_receipts`、`gsc_*_fetch_receipts`、`me_conversion_audit` | 都是「一个域一张、字段各异、没有按请求串起来」，所以需要一张**跨域的链路台账**；域表不动，只在 `source_ref` 里指过去 |
| 其它 Agent 的回执口径 | 95 号 SEO Agent 设计稿 v0.2（`feat/seo-agent-design-v0-2`）：`seo_receipt` 状态 `answered / blocked / rejected / superseded`，请求幂等靠 119 请求表对 `request_id` 的唯一约束 | 各 Agent 的**域内**状态由各自合同定义；写进台账时按 119 的状态机映射（§5），映射表归 119 合同维护 |
| 卡住 / 失败 → 人工任务 | `pm-todo/manual-items.ts`（what / how / href）、内核 `handoff.ts`、我的 `pushPostLaunchItems` | 「请求卡住」新增一种待办，沿用同一管道 |
| 最小回执字段 | `CLAUDE.md §3`「Inngest 工作流硬约束」：request id、client id、source record id、status、cost/provider 影响、no_publish / authorization 状态、created_at | 台账字段就是这一条的落库 |
| 新校验方式 | 内核 `VerificationMethod` 是**封闭枚举**（`types.ts` ~184 行），加新的要改内核（A 级）| **W1 不依赖新校验方式**：下游 Agent 自己出回执 |

## 3. 台账表（最小字段）
表名 `public.agent_request_receipts`，**追加式**（不 UPDATE、不 DELETE）。一行 = 一个阶段的回执。

| 字段 | 类型 | 说明 / 为什么要有 |
|---|---|---|
| `receipt_key` | text **PK** | `<request_id>:<event_name>:<attempt>`。重试 / 重复事件靠它去重，同时是 Inngest 事件 id |
| `request_id` | uuid，FK → `ad_agent_requests(request_id)` | 整条链的编号（74 要求）。回执不能先于请求存在 |
| `seq` | int | 链内序号，从 1 起；`unique(request_id, seq)`。排序只认它，不认时钟 |
| `event_name` | text | 74 要求。`ad_agent.request.<动词>`，见 §5 |
| `client_id` | uuid | 74 要求。写入函数校验与索引行一致（可选：对 `(request_id, client_id)` 建复合 FK，要 119 的表给 `unique(request_id, client_id)`）|
| `status` | text | 74 要求。**这一跳之后**的状态；取值 = 119 合同枚举，不另立 |
| `actor` | text | 这一跳谁写的：广告 Agent / 视频 Agent / 网站 Agent / SEO Agent / 内核 / 人 / 系统 |
| `approved_by` | text | 74 要求。`policy:<策略编号>` 或 `human:<邮箱>`；状态为「已批准」时必填 |
| `authorization_ref` | text | 指向授权记录：`authorization_decisions:<id>`，或 PM 在计划页 / 对话里的批准记录 `<表>:<id>` |
| `no_publish` | boolean | 74 要求。草稿 / 内部动作 = true（默认）；真对外可见 / 花钱 = false |
| `cost_usd` | numeric ≥ 0 | 74 要求。本跳的 **API / 生成成本**，不含广告花费（广告花费只在 `ad_daily_insights`，和内核 §14 K4 同口径）|
| `provider_ref` | jsonb | 平台 / 下游回执号：平台对象 id、工单号、部署号 |
| `source_ref` | jsonb | 指针与证据：`{action_run_id, run_log_id, work_order_id, …}`。**只放指针，不放别处已有的细节** |
| `note` | text | 一句话说人话，W1 直接显示 |
| `created_at` | timestamptz | 74 要求 |

（15 列：74 要的 8 项齐 + 7 项必要扩展 `receipt_key / seq / actor / authorization_ref / provider_ref / source_ref / note`，每项上表已写理由。`waiting_on`、`next_due_at` 是**当前状态**，放 119 的索引表，见 §1、§11。）

**约束（把「没有授权和平台回执不许说做完」写进库，不靠自觉）**
1. `CHECK (NOT (<状态> IN ('已执行','已完成') AND no_publish = false) OR (authorization_ref IS NOT NULL AND provider_ref IS NOT NULL))`：对外 / 花钱的阶段没有授权记录和平台回执，**写不进去**（状态名取合同枚举里对应的两个值）。
2. `CHECK (<状态> <> '已批准' OR approved_by IS NOT NULL)`。
3. 追加式：不开 UPDATE / DELETE 的 RLS，再加一个拒绝 UPDATE / DELETE 的触发器（写法照内核 `authorization_decisions` 的不可变触发器，迁移 ~225 行）。
4. RLS 一律 service-role 模板：`FOR ALL TO service_role USING (true) WITH CHECK (true)`（`CLAUDE.md §7`，漏 `TO service_role` = 对匿名访客敞开）。
5. 索引：`unique(request_id, seq)`；`(client_id, created_at desc)`。

## 4. 唯一写入函数（原子，不靠自觉）
- **一个 SQL 函数**（仅 service role 可调）`append_ad_agent_request_receipt(...)`，一个事务里做四件事：① 锁住索引行（`FOR UPDATE`）；② `seq = 当前最大 + 1`（锁保证不竞争）；③ `insert` 回执，`receipt_key` 冲突 `do nothing` 并返回已有那行（幂等）；④ 把索引行的 `status / waiting_on / next_due_at / updated_at` 改成这条回执之后的值。已进终态的请求不允许再被改回非终态（终态清单取合同；`已完成` 之后允许追加「已对账」）。
- **TS 外壳** `appendAgentRequestReceipt()`（`src/lib/agent-requests/ledger.ts`）：先在 TS 侧把 §3 约束校验一遍（报错说人话，不让库的 CHECK 报错裸奔）→ 调函数 → 发事件（事件 id = `receipt_key`）。**所有写入只能经过它**；再加一条静态扫描测试，只允许它往该表 `insert`。
- 写入方（各自一次调用，不用懂表）：广告 Agent（发出 / 待批准）、视频 / 网站 / SEO Agent（接单 / 草稿 / 上线 / 失败）、对账任务（T+7、T+14）。内核同步器与「开投」链见 §8，W1 不验收。

## 5. 事件名与状态
- 事件名：**`ad_agent.request.<动词>`**（`<域>.<对象>.<动词>`，照 `ads-events.ts`），payload 只带 `{client_id, request_id, receipt_key}`，消费者回库读当前行。监督函数的人手叫醒事件：`ad_agent.request_watch.requested`。
- **状态用 119 的**。下表是 v0.1 的**草案映射**，只用来说明动词与阶段的对应，**状态名以 119 合同枚举为准**（已知含 `pending_pm_approval`；其余待 119 回复后在 v0.3 对齐，§11）：

| 动词（`event_name` 末段）| 阶段含义 | 谁发 | `no_publish` |
|---|---|---|---|
| `issued` | 请求已发出 | 广告 Agent | true |
| `approval_requested` | 等批准（进 `pending_pm_approval`）| 广告 Agent | true |
| `approved` / `rejected` | 批准 / 驳回 | 人或策略 | true |
| `accepted` | 目标 Agent 接单（写工单号）| 目标 Agent | true |
| `delivered` | 草稿 / 变更包已出，待质检 / 待批 | 目标 Agent | true |
| `executed` | 真上线 / 真改动 | 目标 Agent | **false**（必须带授权引用 + 平台回执号）|
| `completed` | 终态成功，附最终回执 | 目标 Agent | 同上 |
| `failed` / `expired` | 失败 / 过期 | 任一方 / 监督函数 | true |
| `reconciled` | T+7 / T+14 对账：动了 / 没动 / 没测成（**不写因果**，结论放 `source_ref`）| 对账任务 | true |

一条典型链（W1 要走通的那条，素材请求）：`issued` → `approved`（策略，内部草稿）→ `accepted`（工单号）→ `delivered`（两版草稿、成本、等质检与 PM）→ `approved`（`human:`PM，发布）→ `executed`（传进广告账户，平台视频 id）→ `completed` → `reconciled`（T+7）。

## 6. W1：「一条请求从发出到有回执」的链路怎么显示
读模型（不写库）——`src/lib/agent-requests/chain.ts`：
```ts
type RequestChain = {
  request_id: string; client_id: string
  state: 'in_progress' | 'waiting_approval' | 'stalled' | 'done' | 'failed' | 'rejected'
  headline: string                    // 一句话：现在到哪了、卡在谁手里、多久了
  hops: Array<{ seq: number; event_name: string; status: string; at: string; actor: string
                approved_by?: string; no_publish: boolean; cost_usd: number; note?: string
                provider_ref?: unknown }>
  waiting_on?: string; next_due_at?: string; overdue_hours?: number     // 来自 119 的索引表（当前状态）
  total_cost_usd: number
}
```
- `loadRequestChain(sb, requestId)`：读 `ad_agent_requests`（当前状态）+ `agent_request_receipts`（每一跳）；有 `source_ref.action_run_id` 的那一跳点开才调内核 `loadActionLineage` 钻取（W1 不验收）。接口 `GET /api/admin/agent-requests/[request_id]`（管理员鉴权）。
- **展示由 105 号在推广计划页做**，读法照现在 `promo/facts.ts` 读我体检回执的方式（读回执，不现算）。每一跳一个点：已发出 → 已批准（谁、几点）→ 草稿已出（成本）→ 已上线（平台回执号）→ T+7 对账；`stalled` 的那一跳标红，写「卡在谁 / 已多久 / 该做什么」，带直达链接。

## 7. 「没回执」监督函数
- Inngest 函数 `ad-agent-request-watch`：每小时一次（新西兰 :35），事件 `ad_agent.request_watch.requested` 可人手叫醒。**只读 119 的索引表**：状态非终态且 `next_due_at < now()` → `stalled`；标题和「卡在谁」再联最新一行回执。
- 写法照我的盯盘：运行回执写 `cron_run_logs`（任务名 `ad-agent-request-watch`，`summary` = {checked, stalled:[request_id…]}）；`stalled` 的请求推一条今日待办：**what**（「某某请求已 N 小时没回执，卡在 谁」）/ **how**（具体点哪里、谁该做什么）/ **href**（W1 链路页直达）；同一请求同一状态一天一条，不刷屏。读不到索引表 = 函数自己失败（如实写 failed），不当成「没有卡住的」。
- 默认时限（写入者发回执时填 `next_due_at`，可按请求覆盖）：预算类批准后 2 小时 / 受众类 24 小时 / 素材类 72 小时出草稿、批准后 24 小时上线 / 页面类 48 小时 / SEO 类 7 天。
- 新 Inngest 函数合并后要有人对 `/api/inngest` 重新 Sync，不然「安静地不跑」。

## 8. W1 验收（只保留一条）与其余先设计不验收
**W1 验收（唯一一条端到端链）**：第一个客户的素材请求（上海团）从 `issued` 走到 `completed`，**每一跳都有回执**（含成本、批准人、`no_publish`、平台回执号），W1 链路页能画出来；上线后的 **T+7** 出 `reconciled`（动了 / 没动 / 没测成）。没真实跑通不叫做好，单元测试绿不能代替这条。

**实现自带的测试（不算验收项，但合并前必须绿）**：
- 库里拦得住：造一条「已执行 + `no_publish=false`」但没有授权引用 / 平台回执号的回执 → 被 CHECK 拒绝（单测 + 当场对库试一次）。
- 幂等：同一个事件重放两次 → 只有一行；缓存可重建：删掉索引的当前状态，修复脚本按台账补回。
- 监督：造一条超时没下一跳的请求 → 一小时内出现一条三件套待办，补上回执后待办消失。
- 状态清单对照合同枚举（漂了就红）；只有 `ledger.ts` 能往该表 `insert`（静态扫描）。

**先设计、不验收（W1 之外）**：
- 其余请求类型（预算 / 受众 / 页面 / SEO）；它们写同一张表，规则不变，等 119 的合同与各 Agent 就绪再各走一条。
- **内核同步器**：Inngest 只读扫 `action_runs where triggered_by='agent' and triggered_by_ref is not null`，把内核状态变化翻译成台账回执（`authorization_ref = authorization_decisions:<id>`，`source_ref.action_run_id` 指回内核）；内核不改一行。
- **「开投」并入（`launch` 类，74 同意）**：我的体检 / 盯盘函数顺手追加阶段回执（`no_publish=true`，`source_ref.run_log_id` 指回 `cron_run_logs` 那份完整回执）；完整回执仍留在 `cron_run_logs`。回填 CTS 10-20 开投那条链、回填内核那 4 条 run，等 W2。

## 9. 分工 / 风险级 / Tier
| 谁 | 交付 |
|---|---|
| 119 | 请求合同 schema + `ad_agent_requests`（索引 + 当前状态，含状态机与 `pending_pm_approval`）；广告 Agent 发 `issued`；合同枚举单一定义 |
| 122（我）| 迁移（只随 PR，不在 PR 内 apply）、写入函数（SQL + `ledger.ts`）、`chain.ts` + 接口、`ad-agent-request-watch`、测试；DeepSeek 分轮写，我审 |
| 105 | 推广计划页的链路展示（读 §6 接口）|
| 106 / 121 / 95 | 各自流程里调写入函数发阶段回执 |
| 74 | 合同验收、W1 验收、与 PM 沟通 |
**风险级 A**：新表 + 新 SQL 写入函数 + 新 Inngest 函数 + 「对外动作没授权写不进去」的库内规则。子牙 + 魏征设计审一次、实施后一次；PM 回「合 N」才合并，apply 迁移另要 PM 显式 go。写代码默认 DeepSeek（`CLAUDE.md §5`）。
**Tier（Inline）**：归位 Kernel / Governance / Verification 基础设施，不新增支柱、不新增能力线；共享代码里不出现客户名 / 行业词；时限默认值是平台常量，个别请求的差异走 `next_due_at`。并入 74 稿里已登记的「素材智能」候选，不另登记。

## 10. 不做 / 残余风险
- **不做**：不改内核任何文件；不新增校验方式；不存广告花费；不替 119 定合同和状态机；不写 UI；不改 `cron_run_logs`；不回写任何广告平台。
- **残余风险**：① 缓存与台账漂移——唯一写入函数在一个事务里改两处 + 可重建脚本 + 单测兜底；② 写入函数被绕过——静态扫描测试 + 表上不开 UPDATE / DELETE；③ 状态枚举抄写漂移——单测对照合同枚举；④ 若 119 的索引表不愿放 `waiting_on / next_due_at`，这两列回退到台账（每跳一份「下一步承诺」），监督函数改为「索引非终态 + 台账最新一行」联查，W1 能做但多一次查询。

## 11. 待 119 确认（我已直接问她，答复进 v0.3）
1. `submitActionRun` 能否带 `triggered_by='agent'` + `triggered_by_ref=<request_id>`（内核类请求编号的落点；W1 的素材链用不到，但设计依赖它）。
2. `ad_agent_requests` 的**列名清单**、**状态枚举全集**（含 `pending_pm_approval`）、请求类型取值（中性名）、合同权威路径当前所在的分支 / 提交（我只读，对齐用）。
3. 索引表能否放 `waiting_on`、`next_due_at` 两列（当前状态）；并给 `unique(request_id, client_id)` 方便复合 FK。
4. 请求类型里能否加 `launch`（开投）；不加的话 `launch` 链的 `request_id` 当软引用（不建索引行），本期不验收。
