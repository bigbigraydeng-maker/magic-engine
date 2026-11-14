# 广告智能体系：「动作请求 → 回执」追踪与回执表设计（v0.5，只设计，不写代码）

日期 2026-10-21 ｜ 起草：122 号（追踪与回执）｜ 要求方：74 号 ｜ 状态：草案 v0.5——并入子牙 + 魏征对 v0.4 的正式复审（子牙阻塞 4 条、魏征 6 条）与 74 号的两个决定（W1 创意链改走「观察型」、`hard_deadline_at` 默认值）；**取代 v0.4**；待两位只看增量的复审 + PM 点头（新表 = A 级，apply 迁移要 PM 显式 go）
依据：74 号架构稿 `docs/specs/2026-10-21-ad-agent-system-v1-architecture.md`；119 号 `docs/specs/2026-10-21-ad-agent-kernel-side-design-v0.4.md`（§8 定了 `ad_agent_apply_receipt` 的语义，点名归 122 写）；v0.3 / v0.4（本分支，保留作历史；**v0.3→v0.4 的两张对账表在 v0.4 稿开头**，本稿不重复）。
事实核对（§2）基于仓库 `9acaf9b45` 的迁移与代码，2026-10-21 当天逐条重读；其中标「子牙查实 / 魏征查实」的几条来自复审，我已对照迁移复核。

## 变更记录 v0.4 → v0.5（复审意见逐条对账）
**74 号的两个决定（先于审查意见）**
| 决定 | v0.5 的处理 | 章节 |
|---|---|---|
| W1 创意链**本期不走 `executed`**（子牙查实：素材池 `approved_by` 是 jsonb 数组字段、无行 id、无一次性语义；`content_work_orders` 没有 `approved_by` 列——“工单批准”当授权来源不成立；改内核是 A 级，W1 不做）。链路改为 `issued → accepted → delivered → approved → observed_live → reconciled`；创意上线的内核动作（暂名 `ads.attach_creative`，A 级）另开卡由 119 评估，落地后再把 `executed` 接上 | 新增请求**模式**（观察型 / 执行型，由函数体按请求类型定：`creative` = 观察型）；新增阶段 `observed_live`（只观察、不声称授权、`no_publish = true`）；观察型下 `executed / completed` 非法；`approved` 在观察型下只是内容批准（记指针当证据，不是授权）| §0 §3.1 §4 §5.3 §9 |
| `hard_deadline_at` 默认值：budget 48h / audience 7 天 / creative 14 天 / page 14 天 / seo 30 天 / launch 空 | 写进 §8，作为合同常量默认，待 119 确认 | §8 §12 |

**子牙（阻塞 4 条 + 1 条要 119 回话）**
| 意见 | v0.5 的处理 | 章节 |
|---|---|---|
| 1. `executed` 的授权与下游动作之间没有绑定 | 执行型 `completed` 须核：授权决策所属 `action_run` **就是** `downstream_ref` 绑定的 run（`kind=action_run`），或该 run 的 `execution_item_id` 等于绑定的执行项（`kind=execution_item`）；工单类没有等价字段，**执行型不允许 `work_order` 下游** | §6 |
| 2. 回链列写入点没人认领 | PR 顺序里明排：执行项创建处、工单创建处各一个“写入点 PR”，先于或同批台账迁移；没有它们，`accepted / linked` 的绑定核验永远失败 | §10 |
| 3. 成本口径：同一动作成本只记一处，总成本不得两边相加 | 内核动作的成本留在内核；台账里带 `source_ref.action_run_id` 的行 `cost_usd` 必须为 0（CHECK）；总成本视图 = 台账行之和，内核成本**单列展示、不相加** | §3.1 §7 |
| 4.「已兑换 ≠ 已成功」（`consumed_at` 是领任务时就写的）| §4 点明：`executed` 只证明动作开始，成功只认 `completed` 的库内回读 | §4 |
| 5. 119 需回一句「同意阶段词表」| 词表现为 14 个（加 `observed_live`），列入对 119 的对齐项 | §3.1 §12 |

**魏征（6 条）**
| 意见 | v0.5 的处理 | 章节 |
|---|---|---|
| 1. `executed` 要核 run 状态与决策的 `action_key`（内核有 `action_key_mismatch`，台账没做）| 函数体里按请求类型写 `action_key` 白名单；`executed` 要求 run 为 `running` 或 `succeeded`，`completed` 要求 `succeeded` | §4 §5.2 |
| 2. `corrected` 是后门 | 限定可更正字段（只有 `note / cost_usd / source_ref` 里的指针）；`provider_ref`、授权、`no_publish`、阶段不可更正；**必须带 `human:` 批准人（类型化）**且 `actor = human`；`cost_usd` 取**替换**语义；不得更正更正行；`reconciled` 必带结构化结果（`match / mismatch / unmeasurable`）+ 证据指针，不一致走人工出口 | §3.1 §5.2 §8 |
| 3. 请求表 `created_at / valid_until` 可伪造，使“创建晚于请求”失效 | 触发器强制 `created_at = now()`、`status = 'requested'`、`downstream_ref` 空、`valid_until` 在 `(created_at, created_at + 30 天]`；建议请求创建也改走 SECURITY DEFINER 函数并撤销 INSERT | §3.3 §12 |
| 4. 触发器 `current_user` 黑名单会漏直连角色 | 改**白名单**（只放函数属主）；加**常驻权限断言**（监督函数每小时核 `has_table_privilege`，违反即红待办）；写明应用运行时不得用属主身份的直连连接串 | §3.3 §8 §11 |
| 5. `completed` 信任的是可变状态（执行卡可被人点完成）| §11 老实补一条：不让它单独撑 W2 的启用前闸 | §11 |
| 6. `search_path` 收紧到空 | `SET search_path = ''`，函数体全限定 `public.xxx`；补用例“在 `public` 建同名函数结果不变” | §3.3 §9 |

## 0. 一段话结论
1. **不重造**：授权 / 执行 / 步骤 / 成本 / 校验的系统记录仍是**内核**（`action_runs`、`authorization_decisions`、`action_run_steps`、视图 `kernel_action_lineage`）；盯盘 / 体检的运行回执仍是 `cron_run_logs`；请求本身仍归 119 的 `ad_agent_requests`。这三样一个字都不搬。
2. **只新增一张追加式「请求回执台账」`agent_request_receipts`**（+ 一张事件发件箱 `ad_agent_event_outbox`）。W1 链路页读「119 的请求表 + 这张台账」就能画出“从发出到有回执”。
3. **防线在库里，不在自觉里**：两张新表对 `service_role` 没有写权限，写入只有一条路——SECURITY DEFINER 函数 `ad_agent_apply_receipt_v1`。函数在一个事务里：先锁请求行、再幂等、再按**函数体里的转移规则**算新状态、再在库内核验授权与下游、最后写回执 + 同事务更新请求行缓存 + 写发件箱。调用方给不了“结论”，只能给“阶段 + 证据”。
4. **两种模式**（函数体里按请求类型定，改它 = 改迁移 = A 级）：**观察型**（本期 `creative`）——台账只记“谁做了什么、人批了什么（指针当证据）、我们观察到了什么”，**从不声称授权或执行**，用 `observed_live` 收尾；**执行型**（其余类型，等内核动作落地）——授权、执行、回读全按 §4 §6 核验，用 `executed → completed` 收尾。
5. **这套防线防什么、不防什么（写明白）**：防——其它窗口 / 脚本 / MCP 绕过函数直接改台账、代码或接线出错造成的假回执、重放与并发、倒退状态。**不防**——持有 `service_role` 钥匙、**又去伪造内核记录**（`action_runs`、`authorization_decisions` 本来就是 `service_role` 可写的，我们核验时读的正是它们）的人，也不防“人点了执行卡完成”这种可变状态被当成成功证据（§11）；前者要收口内核表，是内核 A 级事项，另开卡由 PM 定（§12(b)）。
6. **内核一行代码不改。** 请求编号借内核现成的 `triggered_by='agent'` + `triggered_by_ref` 带过去。
7. **“没回执 / 没对账 / 权限被改”有人管**：每小时的监督函数扫卡住、过期（仅限未上线的）、已完成但缺对账、对账不一致、发件箱漏发、**表权限被人改了**，推今日待办（what / how / href）。

## 1. 分工（一个事实一个家）
| 事实 | 唯一的家 | 谁写 |
|---|---|---|
| 请求是什么：`request_id`、`client_id`、`request_type`、合同正文、`idempotency_key`、`valid_until`、`created_by`、`created_at` | 119 的 `ad_agent_requests` | 广告 Agent / 合同代码（119）创建一次；之后不再改 |
| 当前到哪了：`status`、`downstream_ref`（`{kind, id, terminal_status}`）、`updated_at` | `ad_agent_requests`（台账最新状态的**缓存**）| **只有 `ad_agent_apply_receipt_v1` 能改**（§3 的权限 + 触发器强制）|
| 每一步发生了什么：阶段、前后状态、谁做的、谁批的、成本、`no_publish`、授权、平台回执号、下一步谁 / 最晚何时 | **本稿** `agent_request_receipts`（追加式）| 同一个函数 |
| 授权理由、步骤产物、校验结果、内核动作的成本（内核管的那几跳）| 内核 `kernel_action_lineage` | 内核（不动）。**内核同步器写的台账行只放指针**（`source_ref.action_run_id`、授权的来源 + id），**`cost_usd` 为 0**，不复制内核的状态、批准人、成本 |
| 体检 / 盯盘 / 监督函数的运行回执 | `cron_run_logs` | 各 Inngest 函数（不动）|

规则：① 台账**不存**合同正文、请求类型、当前状态；119 的表**不存**回执、成本、批准人、`no_publish`、授权、平台回执号。② 台账的前后状态与 119 表的 `status` 取值**完全同一套**（合同八态）。③ 缓存可重建：修复入口按每个 `request_id` 取 `seq` 最大的一行回写 `status`，`downstream_ref` 取最近一条 `accepted / linked` 回执里的快照（`source_ref.downstream`）。④ 阶段清单与转移规则是对合同 TS 常量的抄写，**单测把函数对每个（模式, 状态, 阶段）的输出展开成矩阵与合同常量对照**，漂了就红。⑤ 阶段（事件动词）不是请求状态，二者靠函数里的转移规则转换。⑥ **同一动作的成本只记一处**：生产者的生成成本记在台账（如视频 Agent 的 `delivered` 行）；内核动作的成本只在内核；台账总成本 = 台账行之和，内核成本单列展示、**不相加**。

## 2. 事实核对（我今天读的，不是转述）
| 事实 | 出处 | 对设计的影响 |
|---|---|---|
| `authorization_decisions`：`verdict`、`decided_by`（policy / human）、`decided_by_user`、`expires_at`（= 政策的 `decision_ttl_seconds`）、**`consumed_at / consumed_by`**、`action_run_id`、`client_id`；触发器只允许把 `consumed_at / consumed_by` 从空写成一次值；表上**没有撤销 `service_role` 的写权限**。**`consumed_at` 是 run 被领走时就写的（子牙查实）——已兑换只说明动作开始，不说明成功** | `20260808000003_me2_execution_kernel_v1.sql:147-245` | 核验直接读它；持钥者能直写它（§0.5）；已兑换的不再看 `expires_at`；`executed` ≠ 成功，成功只认 `completed` 回读（§4）|
| `action_runs`：`triggered_by`（signal / schedule / human / **agent** / run）、`triggered_by_ref`（自由文本）、`status`（queued / authorizing / authorized / pending_approval / denied / running / **succeeded** / failed / dead_letter / superseded）、`authorization_decision_id`、`action_key`、`execution_item_id`；内核自己有 `action_key_mismatch` 校验（魏征查实）| 同上 `:267-345` | `executed` 核 run 为 running / succeeded 且 `action_key` 在请求类型白名单内；`completed` 核 succeeded（§4 §6）|
| 内核的写函数都是 SECURITY DEFINER，并 `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated`；视图 `kernel_action_lineage` 用 `security_invoker` 且 `REVOKE ALL FROM PUBLIC, anon, authenticated`；内核函数 `search_path` 是 `public` | 同上 `:521/561-563/714/887…`、`:1560-1606` | 本稿照抄，但 `search_path` 收到空串、函数体全限定（§3.3）|
| 追加式触发器先例：`launch_signoff_events` 触发器拦 UPDATE / DELETE / **TRUNCATE**，并 `REVOKE UPDATE, DELETE, TRUNCATE FROM PUBLIC, anon, authenticated, service_role` | `20261019120000_launch_signoff_events.sql` | 照抄，并**再多撤销 INSERT** |
| `execution_items.status` 枚举：`pending / in_progress / completed / skipped / superseded`——**人可以点“完成”**；没有指向请求的列；会被例行批量删除 | `20260513000001_diagnostic_engine.sql:31`、`20260606000001…`、kernel 迁移 `:305-309` 注释 | 成功终态 = `completed`，但这是**可变状态**（§11）；要加回链列；下游会消失，所以要能重绑（`linked`）|
| `content_work_orders.status`：`queued … approved … published / measuring / closed / failed / dead_letter / archived / superseded`；**没有 `approved_by / approved_at` 列**（子牙查实）、没有指向请求的列 | `20260711000002_p21j_content_factory_m1.sql:121-125` | 工单状态只能当“进度”证据，不能当授权记录；要加回链列 |
| 素材池 `creative_pool` 里条目的批准：`approved_by` 是 jsonb 数组字段，无行 id、无一次性语义（子牙查实）| 素材池读写代码 | 不能当授权来源；观察型的内容批准只记指针当证据（§4）|
| RPC 缺失 fail closed 的现成工具 | `src/lib/kernel/rpc-versioning.ts::failClosedIfRpcMissing` | TS 外壳照用（§5）|
| 真 PostgreSQL 集成测试先例与从零重放沙盘 `scripts/db-replay-and-verify.sh`：沙盘里 `service_role` 只是个空角色（`:42`），没有默认授权，拿它测“被拒”恒真 | `optout.integration.pg.test.ts`、脚本 | §9 要求测试先按 Supabase 默认授权给 `service_role`，再验证迁移的 REVOKE 生效 |
| 119 v0.4 §8：`ad_agent_apply_receipt(request_id, expected_old_status, new_status, receipt_seq, …)`，该函数**归 122 写** | 119 v0.4 §8 | 本稿对齐，**语义差异**见 §12 |
| 生产现状（10-21 只读核对）：`action_runs` 4 行，全是人触发、全成功；还没有一条 agent 触发的真实运行 | v0.3 §2 | 执行型是设计；W1 只跑观察型 |

## 3. 表与库内强制
### 3.1 `public.agent_request_receipts`（追加式，一行 = 一个阶段的回执）
| 字段 | 类型 / 约束 | 说明 |
|---|---|---|
| `receipt_key` | text **PK**，`^[0-9a-f-]{36}:[a-z_]+:[A-Za-z0-9._-]{1,64}$` | `<request_id>:<阶段>:<出现编号>`；**出现编号由生产者给**（§7）。同时是 Inngest 事件 id |
| `request_id` | uuid NOT NULL，FK → `ad_agent_requests(request_id)` **ON DELETE RESTRICT** | 回执不能先于请求存在，请求不能连台账一起被删 |
| `client_id` | uuid NOT NULL | **函数从请求行读，不接受调用方传入**；复合 FK `(request_id, client_id)`（要 119 给 `unique(request_id, client_id)`，§12）|
| `seq` | int NOT NULL，`unique(request_id, seq)` | 函数在**持有请求行锁时**取 max+1。只用于展示顺序；因果顺序由转移规则保证 |
| `stage` | text NOT NULL，CHECK 在合同阶段清单内（**14 个**）| `issued / accepted / linked / delivered / approval_requested / approved / rejected / executed / completed / observed_live / failed / expired / reconciled / corrected` |
| `event_name` | text，**生成列** `'ad_agent.request.' \|\| stage` | 不单独存，免得和 `stage` 漂开 |
| `status_before` / `status_after` | text NOT NULL，CHECK 在八态内 | **由函数算出**，调用方不能传 |
| `actor` | text NOT NULL，CHECK 在封闭清单内：`ad_agent / video_agent / website_agent / seo_agent / kernel_sync / human / system` | 机器标识。**`actor` 只是标签，不是凭据**（§8 末）|
| `waiting_on` / `next_due_at` | text / timestamptz | 非终态必填；`next_due_at` 超过 `hard_deadline_at` 时**截断**到它（§8）|
| `approved_by` | text，CHECK `^(policy:[A-Za-z0-9._-]+\|human:[^@\s]+@[^@\s]+\|kernel:[0-9a-f-]{36})$` | `approved` 与 `corrected` 必填；`human:` 的邮箱比对一律 `lower()` |
| `authorization_source` / `authorization_id` | text / **uuid**，两者同时为空或同时有值 | 授权的来源表名（白名单见 §4）与该表里的记录 id；uuid 类型天然规范化。**执行型**的 `approved` / `executed` 必填；**观察型的 `approved / observed_live` 必须为空** |
| `no_publish` | boolean **NOT NULL** DEFAULT true | CHECK `(stage = 'executed') = (no_publish = false)`：只有“真上线 / 真改动”那一跳是 false；**`observed_live` 恒为 true**（它只观察，不声称是我们投出去的）|
| `cost_usd` | numeric(12,4) NOT NULL DEFAULT 0，CHECK ≥ 0 | 本跳 API / 生成成本，不含广告花费。**CHECK `NOT (source_ref ? 'action_run_id') OR cost_usd = 0`**：内核动作的成本只在内核。`corrected` 行的 `cost_usd` 是**替换值**（被更正那一行的成本以最新更正为准）|
| `provider_ref` | jsonb | `executed` 必须是**非空对象**；`observed_live` 必须是含 `ad_id`（text）、`effective_status`（text）、`observed_at`（timestamptz）的**非空对象**——CHECK 用 `jsonb_typeof` + 键存在 |
| `source_ref` | jsonb | 本跳读到 / 产出的**指针**；`accepted / linked` 带 `downstream`（`{kind, id}` 快照，供重建缓存）；观察型 `approved` 带 `approval`（`{kind:'work_order_review', id}`）；`reconciled` 必带 `window`（`T+7 / T+14`）、**`result`（`match / mismatch / unmeasurable`）** 与 `evidence`（指针对象），CHECK 键存在且取值在清单内；`corrected` 必带 `corrects`（被更正的 `receipt_key`）|
| `payload_hash` | text NOT NULL | 函数用规范 `jsonb` 文本算 SHA-256，**不接受调用方传入**；只哈希业务身份字段：阶段、`actor`、`approved_by`、授权来源 + id、`provider_ref`、`source_ref`、`cost_usd`——不含 `waiting_on / next_due_at / note` |
| `note` | text，≤ 2000 字 | 一句话说人话 |
| `created_at` | timestamptz NOT NULL DEFAULT now() | 函数不接受调用方时间，表又没有写权限，所以不能倒填 |

唯一性 / 索引：`unique(request_id, seq)`；`(client_id, created_at desc)`；部分唯一索引 **`unique(authorization_source, authorization_id) WHERE stage = 'executed'`**、**`... WHERE stage = 'approved' AND authorization_id IS NOT NULL`**；**`unique(request_id, (source_ref->>'window')) WHERE stage = 'reconciled'`**。

### 3.2 配套对象
- **`ad_agent_event_outbox`**：`receipt_key` PK + FK、`event_name`、`payload`（只带 `{client_id, request_id, receipt_key}`）、`created_at`、`emitted_at`。函数在写回执的**同一事务**里写一行；`emitted_at` 只能经 `ad_agent_mark_event_emitted_v1(receipt_key)` 从空变一次值（触发器管）。
- **`agent_request_heads`**（视图）：`ad_agent_requests` **LEFT JOIN LATERAL** 最新一行回执——没有任何回执的请求也在里面；带 `last_state_change_at` 与 `hard_deadline_at`（§8）。`WITH (security_invoker = true)`，`REVOKE ALL … FROM PUBLIC, anon, authenticated`，只给 `service_role` SELECT。
- **没有“规则数据表”**：转移规则、模式、`action_key` 白名单、授权来源白名单都写在函数体里。改规则 = 改迁移 = A 级。

### 3.3 权限与触发器（真正的“唯一写入”）
| 对象 | `service_role` 能做什么 | 其它角色 | 触发器兜底 |
|---|---|---|---|
| `agent_request_receipts` | **只有 SELECT**（撤销 INSERT / UPDATE / DELETE / TRUNCATE）| anon / authenticated / PUBLIC：全撤 | BEFORE UPDATE OR DELETE（行级）与 BEFORE TRUNCATE（语句级）一律报错 |
| `ad_agent_event_outbox` | 只有 SELECT | 全撤 | UPDATE 只允许 `emitted_at` 空→一次值；DELETE / TRUNCATE 报错 |
| `ad_agent_requests`（119 的表，**本稿迁移追加**）| SELECT；**INSERT 也撤销**（建议请求创建改走 SECURITY DEFINER 函数 `ad_agent_create_request_v1`，同事务写第一条 `issued` 回执，§12）；撤销 UPDATE / DELETE / TRUNCATE | 全撤 | BEFORE INSERT：`created_at = now()`（覆盖调用方给的值）、`status = 'requested'`、`downstream_ref` 为空、`valid_until` 必须在 `(created_at, created_at + 30 天]`；BEFORE UPDATE：`status / downstream_ref / updated_at` 变动时**只放行函数属主**（白名单），其余任何身份报错 |
| `execution_items.agent_request_id`、`content_work_orders.agent_request_id`（回链列，§6）| 照旧可写其它列 | — | BEFORE UPDATE：该列**只许从空写成一次**，改值或清空报错 |
| 函数 `ad_agent_apply_receipt_v1` / `ad_agent_mark_event_emitted_v1` / `ad_agent_create_request_v1` | `GRANT EXECUTE` 给 `service_role` | `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` | **`SECURITY DEFINER`、`SET search_path = ''`，函数体里所有对象全限定 `public.xxx` / `pg_catalog.xxx`**（内核函数用的是 `public`；这里收到空串，防“有人在 `public` 建同名函数劫持”）|

- **触发器的身份判断用白名单**：只放行“函数属主”（运行时从 `pg_proc` 查本函数的 `proowner`，不硬编码名字）；黑名单（只拦 API 角色）会漏掉脚本用的直连角色（魏征④）。触发器函数本身是 SECURITY INVOKER。
- **常驻权限断言**：监督函数每小时核一遍——`NOT has_table_privilege(角色, 表, 'INSERT/UPDATE/DELETE/TRUNCATE')`（角色 = `service_role / authenticated / anon / PUBLIC`；表 = 回执表、发件箱、请求表的受保护权限）与 `EXECUTE` 权限分布；任何一项被人改回去 → 红待办（§8）。这样“有人 GRANT 回去 / 新迁移默认授权又盖回去”不会静默。
- **应用运行时不得使用属主身份的直连连接串**：Supabase 的 SQL 编辑器、迁移、MCP 的 `execute_sql` 以属主身份跑，不受上面的权限与触发器约束，这是 DBA 通道，靠流程管（A 级、PM 显式 go）；应用代码只用 `service_role` 的 API 连接。
- RLS：新表**启用 RLS 且不建任何策略**（`service_role` 本来绕 RLS，真正的控制是上面的权限与触发器；v0.3 里“不开 UPDATE/DELETE 策略”与“FOR ALL TO service_role”两句互相矛盾，已删，不再把 RLS 当防线）。

## 4. 模式、授权与对外动作
**模式（函数体里按请求类型定；本期 `creative` = 观察型，其余 = 执行型）**
| | 观察型（本期 `creative`）| 执行型（其余类型，等内核动作落地）|
|---|---|---|
| 收尾阶段 | `observed_live → fulfilled` | `executed → completed → fulfilled` |
| `approved` 的含义 | **内容批准**：人在视频审批页批准了成片。`approved_by = human:<邮箱>`，`source_ref.approval = {kind:'work_order_review', id:<工单 id>}`——**只记指针当证据，不是授权**；函数核验该工单存在、客户一致、回链列等于本请求、`status` 已到 `approved` 或更靠后（`approved / publishing / published / measuring / closed`）| **执行授权**：按下面的授权核验 |
| 授权字段 | `authorization_*` 必须为空 | `approved` / `executed` 必填 |
| 非法阶段 | `executed`、`completed`（抛 `illegal_transition`）| `observed_live` |
| `observed_live` | 观察到广告在投：`provider_ref = {ad_id, effective_status, observed_at}`（由观察者——盯盘 / 对账任务——读 Meta 得到，库里**验不了** Meta，所以只是线索，真伪靠 T+7 对账）；`no_publish = true`；下游（成片工单）须已绑定并核验；不声称授权、不声称是我们投出去的 | — |

**执行型的授权来源（函数体里的白名单）——v0.5 只放行 `authorization_decisions`（内核）**。其它来源一律拒绝；创意上线的内核动作（暂名 `ads.attach_creative`，A 级）另开卡由 119 评估，落地后创意类请求才切到执行型（改一次迁移）。
- **`authorization_decisions` 的核验**（`approved` 与 `executed` 都做）：行存在 ∧ `client_id` = 请求的客户 ∧ `verdict = 'allow'` ∧ **决策所属的 `action_run` 满足 `triggered_by = 'agent'` 且 `triggered_by_ref = request_id::text`** ∧ **该决策的 `action_key` 在“该请求类型的白名单”内**（白名单写在函数体里，具体键名由 119 在合同里给；内核有 `action_key_mismatch` 校验，台账不能比内核更宽）；`approved` 阶段另要求决策**未过 `expires_at` 或已被兑换**；`executed` 阶段另要求 **`consumed_at` 非空** ∧ **run 的状态是 `running` 或 `succeeded`**。
- **`executed` ≠ 成功**：`consumed_at` 是 run 被领走时就写的，所以 `executed` 只证明“动作开始了”；**成功只认 `completed` 的库内回读**（`action_runs.status = 'succeeded'`，§6）。展示上 `executed` 一行写“已开始”，不写“已成功”。
- **不要求 `executed` 的授权与 `approved` 的是同一份**（`dead_letter` 恢复 / 接管会重签决策）；改成“两跳的决策都属于本请求的 run”。一次性由 `executed` 上的部分唯一索引保证。
- **`approved_by` 与授权记录里的“人”必须对得上**：`human:<邮箱>` 要求决策 `decided_by = 'human'` 且 `lower(decided_by_user)` = 该邮箱；`policy:` / `kernel:` 要求 `decided_by = 'policy'`。
- 先批准后上线、先上线后完成由转移规则保证。`human:` 的批准必须先有 `approval_requested`（走 `pending_pm_approval`）；`policy:` / `kernel:` 可从 `accepted` 直接到 `executing`。

## 5. 唯一写入函数 `ad_agent_apply_receipt_v1`
### 5.1 签名与返回
`ad_agent_apply_receipt_v1(p_request_id uuid, p_stage text, p_occurrence text, p_expected_old_status text, p_actor text, p_waiting_on text, p_next_due_at timestamptz, p_approved_by text, p_authorization_source text, p_authorization_id uuid, p_cost_usd numeric, p_provider_ref jsonb, p_source_ref jsonb, p_downstream_ref jsonb, p_note text) returns jsonb`
返回 `{ outcome: 'inserted' | 'replayed', seq, status_before, status_after, receipt_key }`；失败抛带**机器可读码**的异常：`illegal_transition`、`stale_expected_status`、`receipt_key_conflict`、`authorization_invalid`、`downstream_invalid`、`readback_failed`、`request_expired`、`missing_next_due`、`correction_not_allowed`、`request_not_found`。
**没有 `p_status`、没有 `p_client_id`、没有 `p_seq`、没有调用方时间**：新状态由函数算，客户从请求行读，序号函数自己取，`created_at` 是库的 `now()`。

### 5.2 一个事务里依次做（锁后幂等）
1. 校验参数形状（阶段在清单内、`p_occurrence` 符合格式、`p_actor` 在清单内）。拼出 `receipt_key`，算出 `payload_hash`。
2. **锁请求行**（`SELECT … FOR UPDATE`）；不存在抛 `request_not_found`。读出请求类型，定**模式**。
3. **权威幂等检查（锁后）**：按 `receipt_key` 查已有回执。有 → 比 `payload_hash`：相同返回 `replayed`；不同抛 `receipt_key_conflict`。因为已经持锁，原调用若还没提交，重试会在第 2 步排队，等它提交后才走到这里，必然命中 `replayed`；INSERT 仍兜住唯一冲突。
4. 比 `p_expected_old_status` 与当前状态，不同抛 `stale_expected_status`。
5. **转移规则**（函数体里的 `VALUES` 表，按（模式, 当前状态, 阶段），见 §5.3）：没有这一行抛 `illegal_transition`。终态（`fulfilled / rejected / expired / failed`）只留 `reconciled`、`corrected`。附加守卫：
   - `approved`：请求未过 `valid_until`（否则抛 `request_expired`）；`accepted → executing` 只许 `approved_by` 是 `policy:` / `kernel:`（执行型）；
   - `expired`：**必须真过了 `valid_until`**；且该请求**没有 `executed` 回执**、**没有已被兑换的授权决策**——否则拒绝；
   - `executed` / `completed` / `observed_live` / `failed`：**不因时间拒绝**（真实发生的事必须能记下来）；
   - `completed`（执行型）：必须已有 `executed` 回执；`launch` 类型本期不允许进入 `fulfilled`（§6）。
6. **阶段专属校验**（SQL 里做，不信调用方）：
   - `approved`：执行型按 §4 核验授权；观察型核验工单指针（§4 表）；
   - `executed`：`no_publish = false`、`provider_ref` 非空对象、授权按 §4 核验（含 `action_key` 白名单、run 状态 running / succeeded）；
   - `observed_live`：观察型；`provider_ref` 含 `ad_id / effective_status / observed_at`，`observed_at` 不晚于 `now()` + 5 分钟、不早于 `approved` 回执；`authorization_*` 为空；下游已绑定并核验；
   - `accepted` / `linked`：可带 `p_downstream_ref {kind, id}`，按 §6 核验后**同事务写入 `ad_agent_requests.downstream_ref`**（`executed` / `observed_live` 之后不允许再改）；
   - `completed`：下游必须已绑定，库内回读（§6）；**回读失败整笔回滚**；
   - `reconciled`：`source_ref` 必带 `window / result / evidence`（取值在清单内）；`result` 是 `mismatch` 或 `unmeasurable` 时回执照写，**监督函数据此出“对账不一致”的人工待办**（§8），不能静默；
   - `corrected`：**只能更正 `note`、`cost_usd`（替换值）、`source_ref` 里的指针**；`provider_ref`、授权、`no_publish`、阶段不可更正；必须 `actor = human` 且 `approved_by = human:<邮箱>`；必带 `corrects`（同一请求下已存在的**非 `corrected`** 回执的 `receipt_key`）与 `note`；违反抛 `correction_not_allowed`。原行保留，展示与总成本以更正为准；
   - 非终态结果必须有 `waiting_on` 与 `next_due_at`（`completed / observed_live` 例外：带对账到期，§8）；`next_due_at` 超过 `hard_deadline_at` 时**截断**，不拒写。
7. `seq = 该请求当前最大 + 1`，写回执（含 `status_before / status_after`）。
8. 更新请求行：`status = status_after`、`updated_at = now()`（必要时 `downstream_ref`）。
9. 写发件箱一行（同事务）。
10. 返回。

TS 外壳 `appendAgentRequestReceipt()`（`src/lib/agent-requests/ledger.ts`）只做三件事：整理参数调 RPC；用 `failClosedIfRpcMissing` 在函数缺失时**当场停**；调用成功后按发件箱发事件并调 `ad_agent_mark_event_emitted_v1`。**回读与核验都不在 TS 里做**。

### 5.3 转移规则（写在函数体里；阶段清单与映射以 119 合同为准，单测展开成矩阵对照）
下表“同状态”= 不改状态。**观察型 / 执行型的差别只在最后两列。**
| 当前状态 \ 阶段 | 之后的状态 |
|---|---|
| `requested` | `issued`→requested（仅第一条回执）；`accepted`→accepted；`rejected`；`failed`；`expired` |
| `accepted` | `linked`、`delivered`→同状态；`approval_requested`→pending_pm_approval；`approved`→executing（执行型仅 policy / kernel 批准）；`rejected`；`failed`；`expired` |
| `pending_pm_approval` | `linked`、`delivered`→同状态；`approved`→executing；`rejected`；`failed`；`expired` |
| `executing` | `linked`（仅在还没有 `executed` / `observed_live` 时）、`delivered`→同状态；`failed`；`expired`（仅在满足 §5.2 第 5 步的守卫时）。**观察型**：`observed_live`→fulfilled。**执行型**：`executed`→executing；`completed`→fulfilled（须已有 `executed`）|
| `fulfilled` | `reconciled`→fulfilled（每个对账窗口至多一次）；`corrected`→fulfilled |
| `rejected / expired / failed` | 仅 `corrected`→同状态 |

另：**`corrected` 在任何状态下都合法**（不改状态；字段与批准人的限制见 §5.2）。

### 5.4 静态扫描降为辅助
仍保留“只有 `ledger.ts` 调这个 RPC”的全仓扫描，但**它不再是防线**：库里没有写权限，直接被拒（属主身份 SQL 除外，§3.3）。

## 6. 下游绑定、`fulfilled` 的回读（库内）
`ad_agent_requests.downstream_ref = {kind, id, terminal_status}`：
- **绑定**：`kind / id` 在 `accepted` 或 `linked` 回执里由函数写并核验；`executed` / `observed_live` 之前可以重绑（执行卡被批量删、绑错了、换了新工单），每次绑定都是一行回执；之后锁死。**没绑定就 `completed` / `observed_live` 不了**（fail closed）。
- **绑定时的核验**：对象存在 ∧ 客户一致 ∧ 回链列等于本请求（`action_run` 看 `triggered_by_ref`）∧ **对象创建晚于请求** ∧ **绑定那一刻对象还不在成功终态**。`created_at` 之所以可信，是因为请求表的 `created_at` 由触发器强制为 `now()`（§3.3）。
- **回链列只许从空写成一次**（触发器）——旧对象不能被改绑到新请求；错绑的对象就废在那儿，请求侧重绑另一个。
- **`terminal_status` 只在 `completed`（执行型）或 `observed_live`（观察型）时由函数回读后写**，不接受调用方提供。

**执行型 `completed` 的回读**（按 `kind`；**只允许 `action_run` 与 `execution_item` 两类下游**——工单表没有和 run 对应的字段，无法把授权绑到工单）：
| kind | 回读条件（全部满足才放行）|
|---|---|
| `action_run` | `action_runs.status = 'succeeded'` ∧ `client_id` = 请求客户 ∧ `triggered_by = 'agent'` ∧ `triggered_by_ref = request_id::text` ∧ `created_at ≥ 请求.created_at` ∧ **该 run 就是 `executed` 回执里授权决策所属的 run**（授权与下游动作绑在一起，子牙1）|
| `execution_item` | `status = 'completed'` ∧ `client_id` 一致 ∧ `agent_request_id` = request_id ∧ 创建晚于请求 ∧ **`executed` 授权所属 run 的 `execution_item_id` 等于该执行项**（子牙1）|
| 其它（含 `work_order`）| **拒绝**（fail closed）；新增 kind = 改迁移 |

**观察型 `observed_live` 的下游核验**：`kind` 为 `work_order`（成片工单）或 `execution_item`；对象存在 ∧ 客户一致 ∧ 回链列等于本请求 ∧ 创建晚于请求 ∧ 工单 `status ∈ ('approved','publishing','published','measuring','closed')`（执行项 `status = 'completed'`）——即“成片确实被批准过”。**这只证明成片在流程里走到了批准，不证明广告真的在 Meta 上投了**——后者是 `provider_ref` 里的观察线索，真伪靠 T+7 对账。

- `fulfilled` 的 CHECK（119 的表上）：`status <> 'fulfilled' OR (downstream_ref ? 'kind' AND downstream_ref ? 'id' AND downstream_ref->>'terminal_status' IS NOT NULL)`；119 §8 的更强版（`terminal_status` 属于按 kind 约定的成功集合）兼容，建议用它（§12）。
- **`launch`**：本期不写、也不允许 `fulfilled`；W2 再定 `cron_run_log` 这个 kind 的库内核验。

## 7. `receipt_key`、重试与事件
- **出现编号由生产者给，是业务编号，不是重试次数**：`delivered` 用草稿版本号（如 `draft-2`）；`executed` 用授权 id 的后缀；`linked` 用被绑对象 id 的后缀；`observed_live` 用观察到的广告 id 的后缀；`reconciled` 用窗口名（`t7`）；其它一次性阶段用 `1`。重试 / 重放用同一个编号，所以幂等；合法的第二次 `delivered`（两版草稿）编号不同，所以不会被吞。
- 同键同载荷 → `replayed`（成本不会重复累计）；同键异载荷 → `receipt_key_conflict`；**错写了怎么办 → `corrected` 更正回执**（受限，§5.2），不改原行。
- **成本口径**：同一动作的成本只记一处（§1 规则⑥）。内核同步器写的行 `cost_usd = 0`（CHECK 强制），台账总成本视图 = 台账行（按“被更正者以更正为准”）之和，**内核成本单列展示、不与它相加**。
- **发件箱**：回执与待发事件在同一事务落库；TS 外壳随后发事件（事件 id = `receipt_key`）并标记已发；崩在中间，监督函数把 `emitted_at` 为空超过 10 分钟的补发。**发件箱不是安全边界**，且 Inngest 按事件 id 去重只有约 24 小时——**所有消费者必须按 `receipt_key` 幂等**。
- 119 的 `idempotency_key` 含“周期日”：周期日取 NZ 日期（写进合同）；`failed / rejected / expired` 之后同周期要能重发——建议带 `supersedes_request_id` 或把重发次数并进键（§12）。

## 8. 监督函数 `ad-agent-request-watch`（每小时，新西兰 :35；`ad_agent.request_watch.requested` 可人手叫醒）
读 `agent_request_heads`，判六类（运行回执写 `cron_run_logs`；读不到请求表 = 函数自己失败，如实写 failed）：
1. **卡住**（非终态）：`next_due_at < now()`，**或** `now() > hard_deadline_at`。`hard_deadline_at = 请求.created_at + 该请求类型的最长全程`——**默认（74 号定）：budget 48 小时 / audience 7 天 / creative 14 天 / page 14 天 / seo 30 天 / launch 空**；可按请求覆盖但不得超过 30 天；函数写 `next_due_at` 时超过它就**截断**（不拒写），所以反复追加“草稿已出”之类的回执推迟不了“卡住”。**没有任何回执的请求**：发出后 2 小时仍无 `accepted` → 卡住。
2. **过期**：非终态且真过了 `valid_until`——没有 `executed` / `observed_live` 回执、也没有已兑换授权 → 经函数追加 `expired`；**已有 `executed` / `observed_live` 或授权已被兑换** → 不得转 `expired`（函数拒绝），改推红待办“已上线（或已兑换）但已过有效期，请人决定是否停”。
3. **已完成但缺对账**：`fulfilled` 且对账到期（T+7）已过、没有对应窗口的 `reconciled` → 待办。
4. **对账不一致**：`reconciled` 的 `result` 是 `mismatch` 或 `unmeasurable` → **需人工的待办**（what：哪条请求、比对出什么不一致；how：谁去核；href：链路页），人处理后追加 `corrected` 备注或另开请求；不静默。
5. **权限断言**：核 §3.3 的 `has_table_privilege` / `EXECUTE` 权限分布，被改回去 → 红待办（“台账的写保护被人改了”）。
6. **发件箱漏发**：补发（§7）。
- 待办写法：what / how / href 三件套；同一请求同一状态一天一条。默认时限（写入者填 `next_due_at` 时用）：预算类批准后 2 小时 / 受众类 24 小时 / 素材类 72 小时出草稿、批准后 24 小时观察到上线 / 页面类 48 小时 / SEO 类 7 天，**都受 `hard_deadline_at` 约束**。
- **`actor` 不是凭据**：任何依赖链上回执的闸**只认库内核验通过的结果**（执行型：`completed` + 下游回读；观察型：`observed_live` 只是观察线索，**不能**单独当“启用前闸”的依据，见 §11），不认 `actor` 文本。
- 新 Inngest 函数合并后要有人对 `/api/inngest` 重新 Sync；新增函数要登记 cron 登记表（机器判 A）。

## 9. W1 验收与测试
**W1 验收（唯一一条端到端链，74 号 10-21 改口后的版本）**：诊断 → creative 请求（`issued`）→ 视频 Agent 接单（`accepted`，绑定成片工单 / 执行项）→ 出片并过质检（`delivered`，带成本）→ PM 在视频审批页批准（`approval_requested` → `approved`，记指针当证据）→ 观察到广告在投（`observed_live`，读 Meta）→ T+7 对账（`reconciled`，带结构化结果）。每一跳有回执（含成本、批准人、`no_publish`、观察线索、下一步谁 / 最晚何时），链路页能画出来；`observed_live` 过了下游核验；T+7 出 `reconciled`。没真实跑通不叫做好，单测绿不能代替。**创意上线的内核动作落地前，不验收 `executed / completed` 这条路。**

**实现自带的测试（合并前必须绿；库内规则必须有真 PostgreSQL 测试，照 `optout.integration.pg.test.ts` 的写法）**：
- **测试库先按 Supabase 的默认授权给 `service_role / authenticated / anon` 建好角色和权限**（沙盘里 `service_role` 是空角色，不先授权，“被拒”恒真），再 `SET ROLE` 逐个试写；另用**属主身份的脚本连接**试 UPDATE 请求表的 `status`：必须被触发器拒（白名单），只有经函数路径才成功。
- **`search_path` 劫持**：在 `public` 里建同名函数 / 同名表 / 同名操作符，调用函数的结果不变。
- 转移矩阵：把函数对每个（模式, 状态, 阶段）的输出展开，与合同常量逐格对；观察型下 `executed / completed` 被拒、执行型下 `observed_live` 被拒；终态后再 `approved`、倒退、没有 `executed` 就 `completed` → 都被拒。
- 授权（执行型）：缺授权 / 别的客户 / 决策所属 run 的 `triggered_by_ref` 不是本请求 / `action_key` 不在白名单 / run 状态不是 running 或 succeeded / 未兑换 / 同一授权第二次 `executed`（含 uuid 大小写写法）/ `no_publish = true` / `provider_ref = {}` / `human:` 邮箱与决策里的人对不上 → 全部被拒；`approved` 时决策已过期但已兑换 → 放行；`completed` 的下游 run 不是授权所属 run → 被拒。
- 观察型：`approved` 的工单指针指向别客户 / 回链列不是本请求 / 状态还没到 `approved` → 被拒；`observed_live` 缺 `ad_id / effective_status / observed_at`、`observed_at` 在未来或早于 `approved`、带了授权字段 → 被拒。
- 绑定与回读：`downstream_ref` 指向别客户的 run、`triggered_by_ref` 对不上、`created_at` 早于请求、绑定时已是成功终态的旧对象、回链列被改写 → 被拒且库里什么都没变；请求表 `created_at` / `valid_until` 被伪造（直接 INSERT）→ 被触发器纠正 / 拒绝；`executed` 之前重绑成功、之后被拒。
- `corrected`：想改 `provider_ref` / 授权 / `no_publish` / 更正一条更正行 / `actor` 不是 human / 没有 `human:` 批准人 → 被拒；成本替换后总成本按替换值算；内核同步器行（带 `action_run_id`）`cost_usd > 0` → 被 CHECK 拒。
- `reconciled`：缺 `result / evidence`、取值不在清单 → 被拒；`mismatch / unmeasurable` 写入后出人工待办。
- 幂等与并发：同键同载荷重放 → `replayed`；两个并发的同键调用 → 一个 `inserted` 一个 `replayed`；同键异载荷 → `receipt_key_conflict`；两版草稿 → 两行；事务中途失败 → 回执、请求行、发件箱都没写；同一请求两个并发不同阶段 → 串行化后按新状态判转移。
- 时间：`expired` 在 `valid_until` 之前被拒；已 `executed` / `observed_live` 或授权已兑换的请求 `expired` 被拒；`executed / completed / observed_live` 过了 `valid_until` 仍能写；`next_due_at` 超限被截断。
- 监督：造超时、超 `hard_deadline_at`、无回执、缺对账、对账不一致、发件箱漏发、已上线且过期、**权限被改回去**各一条 → 各出对应待办 / 补发。
- 清单对照：阶段清单（14）、八态、转移矩阵、`hard_deadline_at` 默认值对照合同常量；静态扫描（辅助）；缓存重建（清掉请求行 `status / downstream_ref`，走重建入口补回）。

**先设计、不验收（W1 之外）**：执行型的整条路（等内核动作落地）；其余请求类型；内核同步器（只读扫 `action_runs where triggered_by='agent'`，翻译成台账行，**只放指针**，`cost_usd = 0`）；`launch`；回填 CTS 10-20 开投那条链、回填内核那 4 条 run。

## 10. 分工 / PR 顺序 / 风险级 / Tier
| 谁 | 交付 |
|---|---|
| 119 | 合同目录（八态、**14 个**阶段 / 事件名常量、按（模式, 状态, 阶段）的转移矩阵、`action_key` 白名单键名、请求类型含 `launch`）+ `ad_agent_requests` 迁移（含 `unique(request_id, client_id)`）；`ads.attach_creative`（A 级内核动作）的评估；广告 Agent 发 `issued` |
| 122（我）| 台账迁移（随 PR，不在 PR 内 apply）：回执表与发件箱、三个函数与视图、权限与触发器、对 `ad_agent_requests` 的追加、`execution_items` / `content_work_orders` 回链列与“只写一次”触发器；TS 外壳；`chain.ts` + 接口；监督函数（含权限断言）；测试（含真 PostgreSQL）。DeepSeek 分轮写，我审 |
| 回链列写入点（子牙2）| **①执行项创建处**（`/execution` 路由 / 执行看板创建执行项的代码，owner 待 74 指派）；**②工单创建处**（106 / 121）。这两个“写入点 PR”**先于或同批台账迁移上线**，各自在创建时写 `agent_request_id`；没有它们，`accepted / linked` 的绑定核验永远失败 |
| 105 | 推广计划页的链路展示（读 `chain.ts` 接口）|
| 106 / 121 / 95 | 各自流程里调写入函数发阶段回执 |
| 74 | 合同验收、W1 验收、与 PM 沟通 |
**PR 顺序**：①119 的 `ad_agent_requests` 迁移与合同 → ②回链列写入点 PR（两个）→ ③本台账迁移（两边迁移分开 PR、互不夹带）→ ④W1 链路接线。
**风险级 A**：新表 + 新 SQL 写入函数 + 权限收口 + 新 Inngest 函数 + 对外动作授权核验 + `fulfilled` 回读。子牙 + 魏征复审一次、实施后一次；PM 回“合 N”才合并（钉签字 SHA），apply 迁移另要 PM 显式 go。写代码默认 DeepSeek；库内函数与权限这类 A 级核心，按 `CLAUDE.md §5` 例外可由我自己写，PR 里写明原因。
**Tier（Inline）**：归位 Kernel / Governance / Verification 基础设施，不新增支柱、不新增能力线；共享代码里不出现客户名 / 行业词；时限常量是平台默认值，个别请求的差异走 `next_due_at`（受 `hard_deadline_at` 约束）。

## 11. 残余风险（诚实写明，库里管不到的）
- **持钥者伪造内核记录**：`service_role` 本来能直写 `action_runs`、`authorization_decisions`，我们的核验读的正是它们——有钥匙又会伪造的人，可以造一条成功的 run 和一份已兑换的“人批准”决策，把执行型的链放行到 `fulfilled`。本设计防不住这个；要防得收口内核表的写权限，是内核 A 级事项（§12(b)）。
- **`completed` / `observed_live` 信任的是可变状态**：执行项 `completed` 是人可以点的；工单 `approved…closed` 是工厂流程里的状态；`observed_live` 的 Meta 观察线索库里验不了。因此**这些成功终态不单独撑 W2 的“启用前”闸**——闸需另有不可被点的证据（执行型的 `action_run` 回读，或 T+7 对账 `match`）。
- **平台回执号 / 观察线索的真伪库里验不了**（外部系统）：真伪靠授权真实且一次性（执行型）→ 下游对象库内回读 → T+7 `reconciled`。
- **属主身份 SQL 不受限**（迁移、SQL 编辑器、MCP 的 `execute_sql`）：DBA 通道，靠流程管；应用运行时不得用属主身份的直连连接串；常驻权限断言（§3.3 §8）只能发现“权限被改回去”，发现不了属主身份直接改数据。
- 阶段清单 / 转移规则 / 合同常量三处抄写，漂开只能靠矩阵对照单测发现；合同目录落地前本稿的映射是草案。
- 本稿所有规则在迁移 apply 之前都是纸面设计；A 级，apply 要 PM 显式 go，且先在一次性的测试库里把 §9 的用例跑一遍。

## 12. 给 119 的对齐项 与 剩余待办
**与 119 v0.4 §8 的差异（请她确认；其余语义全部沿用）**
1. 函数入参：119 稿是 `new_status` + `receipt_seq`；本稿改成 **`stage` + 函数体里的转移规则**（库里算，不信调用方，规则不放可改的表里）。保留的：`expected_old_status`、行锁、终态不可覆盖、乱序不倒退。`receipt_seq` 由函数在持锁时取。
2. **阶段词表现为 14 个**（v0.3 的 11 个 + `linked / corrected / observed_live`），请 119 回一句“同意词表”并写进合同常量。
3. **请求模式**：`creative` = 观察型（本期），其余 = 执行型；`creative` 切到执行型需等 `ads.attach_creative`（A 级内核动作）落地并由 119 评估——请她在合同里给出模式表与每个请求类型的 `action_key` 白名单键名。
4. `downstream_ref`：沿用 `{kind, id, terminal_status}`，`kind / id` 由函数写并核验（`executed / observed_live` 前可重绑），`terminal_status` 只由函数回读后写；执行型下游只允许 `action_run` / `execution_item`。
5. `ad_agent_requests` 要加：`unique(request_id, client_id)`；**请求创建改走 SECURITY DEFINER 函数 `ad_agent_create_request_v1`（建议由 119 写，我对接）：同事务写第一条 `issued` 回执、撤销 service_role 的 INSERT；若她不愿改，退而求其次用触发器强制 `created_at = now()`、`status = 'requested'`、`downstream_ref` 空、`valid_until ∈ (created_at, created_at + 30 天]`**；撤销 UPDATE / DELETE / TRUNCATE（这几条随我的迁移追加，她的迁移先合并即可）。
6. 幂等键：周期日取 **NZ 日期**写进合同；`failed / rejected / expired` 之后同周期重发的办法（`supersedes_request_id` 或把重发次数并进键）。
7. `valid_until`：过期 = 追加 `expired` 回执，**但已有 `executed / observed_live` / 授权已兑换的请求不得过期**；`approved` 须在 `valid_until` 之前；上限 30 天。
8. `hard_deadline_at` 默认值（74 号定）：budget 48h / audience 7 天 / creative 14 天 / page 14 天 / seo 30 天 / launch 空——写进合同常量，请 119 确认。
9. `launch`：本期不写台账行、不允许 `fulfilled`；W2 再定。

**剩余待办**
- **(a)** 创意上线的内核动作 `ads.attach_creative`（A 级，另开卡由 119 评估）：落地后创意类请求才切到执行型，同时把执行型的授权来源 / `action_key` 白名单 / 下游绑定补齐（一次 A 级迁移）。在此之前创意链走观察型，**不依赖任何新的授权来源**。
- **(b)** 内核表收口：`action_runs` / `authorization_decisions` 的写权限只留给内核函数（§11 第一条）。内核 A 级卡，PM 定，不在本稿范围。
- (c) 回链列写入点两个 PR 的 owner（§10）：执行项创建处待 74 指派；工单创建处 106 / 121。
- (d) 合同目录落地后，对照阶段清单与转移矩阵，更新 §5.3。
