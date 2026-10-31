# 广告智能体系：「动作请求 → 回执」追踪与回执表设计（v0.4，只设计，不写代码）

日期 2026-10-21 ｜ 起草：122 号（追踪与回执）｜ 要求方：74 号 ｜ 状态：草案 v0.4——并入子牙 5 条 + 次要、魏征 6 组，对齐 119 号 v0.4 §8，并已过一轮自查预审（4 条 P0 + 8 条 P1 已并入）；**取代 v0.3**；待子牙 + 魏征复审 + PM 点头（新表 = A 级，apply 迁移要 PM 显式 go）
依据：74 号架构稿 `docs/specs/2026-10-21-ad-agent-system-v1-architecture.md`；119 号 `docs/specs/2026-10-21-ad-agent-kernel-side-design-v0.4.md`（§8 定了 `ad_agent_apply_receipt` 的语义，点名归 122 写；该稿目前在 119 的工作区，提交后以其分支为准）；v0.3（本分支 `2026-10-21-agent-request-receipt-ledger-design-v0.3.md`，保留作历史）。
事实核对（§2）基于仓库 `9acaf9b45` 的迁移与代码，2026-10-21 当天逐条重读，不是转述。

## 变更记录 v0.3 → v0.4
魏征建议「重写后再审」——这版把**防线从“靠 TS 自觉”整体挪进数据库**：一个 SECURITY DEFINER 函数是台账唯一的写入口，状态机、授权、回读全在库里算，调用方只能给“阶段 + 证据”，给不了“结论”。**同时把这套防线能防什么、防不了什么写明白（§0、§11）**——预审指出初稿对“持钥者伪造内核记录”说得过头。

**A. 两位审查官意见逐条对账**
| 来源 | 意见 | v0.4 的处理 | 章节 |
|---|---|---|---|
| 子牙1（阻塞）| 对外动作的 CHECK 可绕：`no_publish` 自报、`{}` 也算平台回执、授权引用任意字符串 | `no_publish` NOT NULL 且与阶段双向绑定；平台回执必须是非空对象；授权引用拆成「来源 + 类型化 uuid」，由函数**在库内核验**（客户、裁决、属于本请求的 run、是否被兑换）| §3 §4 |
| 子牙2（阻塞）| “唯一写入函数”库里没强制 | 入参是**阶段**，新状态由函数体里的转移规则算（不是可被改的数据表）；回执 / 发件箱表对 `service_role` 撤销全部写权限；请求表的 `status / downstream_ref` 加触发器兜底 | §3 §5 |
| 子牙3 | 状态在加锁前算、终态拦截排在幂等之前 | **锁后**再做权威幂等检查，再校验状态、算 seq；出现编号由生产者给业务编号 | §5 §7 |
| 子牙4 | T+7 对账没人盯；`downstream_ref` 谁写 | `completed` 回执带对账到期，监督补扫；`downstream_ref` 由函数在 `accepted` / `linked` 回执的同一事务里写并核验 | §6 §8 |
| 子牙5 | 视图 / 函数权限缺收口 | 视图 `security_invoker` + `REVOKE ALL`；函数 `REVOKE EXECUTE FROM PUBLIC, anon, authenticated` | §3 §5 |
| 子牙·次要 | RPC 缺失 fail closed；追加式拦 DELETE 要写外键语义 | TS 外壳用 `failClosedIfRpcMissing`，函数名带 `_v1`；外键 `ON DELETE RESTRICT` + TRUNCATE 触发器 | §3 §5 |
| 子牙·分工 | 内核同步器只许存指针 | 写明：同步器行只放指针 | §1 §9 |
| 魏征① | 授权引用无外键 / 可为空 / 空串；一次批准可对应无限 `executed`；不要求先批准 | NOT NULL + 格式 CHECK；来源白名单在函数里核验；**一个授权至多撑一次 `executed`**（类型化 uuid 上的部分唯一索引）；`executed` 只能在 `approved` 之后；**`completed` 之前必须已有 `executed`** | §3 §4 §5 |
| 魏征② | `fulfilled` 回读可绕 | 回读搬进 SQL：核客户、`triggered_by_ref`、创建晚于请求、成功终态；回链列一次性写入；`terminal_status` 由函数写；`launch` 本期不允许 `fulfilled` | §6 |
| 魏征③ | 追加式防线名存实亡 | 撤销 `service_role` 的 INSERT / UPDATE / DELETE / TRUNCATE；触发器拦 UPDATE / DELETE / TRUNCATE；复合外键；`client_id` 不由调用方给；规则不放在可被改的数据表里 | §3 |
| 魏征④ | 无 `expected_old_status` 与转移表；与 119 §8 冲突 | 转移规则 + 行锁 + `expected_old_status`；接口对齐 119 §8，差异逐条列出 | §5 §12 |
| 魏征⑤ | `<attempt>` 谁生成；合法第二次 `delivered` 被吞；事件无 outbox | 业务出现编号 + 载荷哈希（只哈希业务身份字段）；返回 `inserted / replayed`；outbox；消费者按 `receipt_key` 幂等 | §7 |
| 魏征⑥ | 已 `executed` 的被置 `expired`；`next_due_at` 可无限推迟；无 `issued` 的请求永不被判卡住；`actor` 可冒名 | `expired` 须核 `valid_until` 且无 `executed` / 无已兑换授权；`hard_deadline_at` 兜底（超限时**截断**不拒写）；heads 视图含无回执的请求；`actor` 封闭枚举且**不当凭据** | §3 §8 |

**B. 自查预审（独立审查官读初稿）的 4 条 P0 + 8 条 P1，已并入**
| 预审意见 | v0.4 的处理 |
|---|---|
| P0-1 转移表 / 授权来源表本身 `service_role` 可改，插一行就能让 `requested → fulfilled` | **不再用数据表放规则**：转移规则、授权来源白名单都写在函数体里（只能经迁移改，迁移 = A 级）；回执 / 发件箱表撤权（§3.2、§3.3、§5.3）|
| P0-2 核验读的 `action_runs` / `authorization_decisions`，`service_role` 本来就能直写（内核自己就是这么写的），伪造一条成功的 run + 已兑换的决策就能全程放行 | **老实改口**：台账防的是“绕过函数直接改台账”和“代码 / 接线出错”，**不防持钥者连内核记录一起伪造**；那一层要收口内核表写权限，是内核的 A 级事项，另开卡由 PM 定（§0.4、§11、§12(b)）|
| P0-3 `executing → completed` 不要求先 `executed`，对外动作可跳过全部授权规则 | 转移规则：`completed` 之前必须已有 `executed` 回执（合同日后若定义了“纯建议类”请求类型再单独放开，放开前一律要求）|
| P0-4 回链列无写保护，可把旧的已发布工单补写成本请求的下游 | 回链列**只许从空写成一次**（触发器）；绑定时函数核验“下游创建晚于请求”且“绑定时不在成功终态”；错绑靠 `linked` 阶段重绑请求侧（§6）|
| P1-1 幂等查在锁前，原调用未提交时重试得 `stale_expected_status` 或唯一冲突 | 幂等检查挪到**锁后**，并兜住唯一冲突当 `replayed`（§5.2）|
| P1-2 内核决策有 `expires_at`，同步晚到会被拒；`dead_letter` 恢复会重签；`approved` 不核决策所属 run | 已兑换的决策不再看 `expires_at`；`approved` / `executed` 都核“决策所属 run 的 `triggered_by_ref` = 本请求”；不再要求两跳是同一份决策（§4）|
| P1-3 同一 uuid 多种写法绕过唯一索引 | 授权拆成 `authorization_source text` + `authorization_id uuid`（类型化，天然规范化），唯一索引建在两列上（§3.1）|
| P1-4 `accepted` 强制写下游：有的类型没有 kind、执行卡会被批量删 | `downstream_ref` 改为可在 `accepted` 或之后的 `linked` 回执里绑定 / 重绑（`executed` 之前）；没绑定就 `completed` 不了（fail closed）（§6）|
| P1-5 `expired` 不核 `valid_until`；`approved` / `executed` 不核；`next_due_too_late` 拒写合法回执 | `expired` 须真过了 `valid_until`；`approved` 须未过期；`executed / completed / failed` 不因时间拒写；`next_due_at` 超限**截断**不拒写（§5 §8）|
| P1-6 载荷哈希范围未定；错写无更正阶段 | 只哈希业务身份字段；新增 `corrected` 更正阶段（§3 §7）|
| P1-7 触发器须 INVOKER、勿硬编码属主；属主身份 SQL 不受限须写明；重放沙盘里 `service_role` 是空角色，“被拒”恒真 | 触发器用 `current_user IN (API 角色)` 黑名单判断；写明属主 SQL（迁移 / SQL 编辑器 / MCP）不受限；测试要先按 Supabase 默认授权给 `service_role`，再验证 REVOKE（§3.3 §9 §11）|
| P1-8 mark 函数可误标致永不补发；Inngest 去重仅 24 小时 | 发件箱不是安全边界；**消费者按 `receipt_key` 幂等**（§7）|
| P2 | 缓存重建带 `downstream_ref`；`reconciled` 窗口 CHECK；`corrected` 可在终态后更正成本；邮箱比对 `lower()`；`created_at` 只有库自己的 `now()`；函数名 `_v1` |

## 0. 一段话结论
1. **不重造**：授权 / 执行 / 步骤 / 成本 / 校验的系统记录仍是**内核**（`action_runs`、`authorization_decisions`、`action_run_steps`、视图 `kernel_action_lineage`）；盯盘 / 体检的运行回执仍是 `cron_run_logs`；请求本身仍归 119 的 `ad_agent_requests`。这三样一个字都不搬。
2. **只新增一张追加式「请求回执台账」`agent_request_receipts`**（+ 一张事件发件箱 `ad_agent_event_outbox`）。W1 链路页读「119 的请求表 + 这张台账」就能画出“从发出到有回执”。
3. **防线在库里，不在自觉里**：两张新表对 `service_role` 没有写权限，写入只有一条路——SECURITY DEFINER 函数 `ad_agent_apply_receipt_v1`。函数在一个事务里：先锁请求行、再幂等、再按**函数体里的转移规则**算新状态、再在库内核验授权与下游成功、最后写回执 + 同事务更新请求行缓存 + 写发件箱。调用方给不了“结论”，只能给“阶段 + 证据”。
4. **这套防线防什么、不防什么（写明白）**：防——其它窗口 / 脚本 / MCP 绕过函数直接改台账、代码或接线出错造成的假回执、重放与并发、倒退状态。**不防**——持有 `service_role` 钥匙、**又去伪造内核记录**（`action_runs`、`authorization_decisions` 本来就是 `service_role` 可写的，我们核验时读的正是它们）的人；这一层要收口内核表，是内核 A 级事项，另开卡由 PM 定（§12(b)）。
5. **内核一行代码不改。** 请求编号借内核现成的 `triggered_by='agent'` + `triggered_by_ref` 带过去。
6. **“没回执 / 没对账”有人管**：每小时的监督函数扫卡住、过期（仅限未上线的）、已完成但缺对账、发件箱漏发，推今日待办（what / how / href）。

## 1. 分工（一个事实一个家）
| 事实 | 唯一的家 | 谁写 |
|---|---|---|
| 请求是什么：`request_id`、`client_id`、`request_type`、合同正文、`idempotency_key`、`valid_until`、`created_by`、`created_at` | 119 的 `ad_agent_requests` | 广告 Agent / 合同代码（119）INSERT 一次；之后不再改 |
| 当前到哪了：`status`、`downstream_ref`（`{kind, id, terminal_status}`）、`updated_at` | `ad_agent_requests`（台账最新状态的**缓存**）| **只有 `ad_agent_apply_receipt_v1` 能改**（§3 的权限 + 触发器强制）|
| 每一步发生了什么：阶段、前后状态、谁做的、谁批的、成本、`no_publish`、授权、平台回执号、下一步谁 / 最晚何时 | **本稿** `agent_request_receipts`（追加式）| 同一个函数 |
| 授权理由、步骤产物、校验结果（内核管的那几跳）| 内核 `kernel_action_lineage` | 内核（不动）。**内核同步器写的台账行只放指针**（`source_ref.action_run_id`、授权的来源 + id），不复制内核的状态、批准人、成本 |
| 体检 / 盯盘 / 监督函数的运行回执 | `cron_run_logs` | 各 Inngest 函数（不动）|

规则：① 台账**不存**合同正文、请求类型、当前状态；119 的表**不存**回执、成本、批准人、`no_publish`、授权、平台回执号。② 台账的前后状态与 119 表的 `status` 取值**完全同一套**（合同八态）。③ 缓存可重建：修复入口按每个 `request_id` 取 `seq` 最大的一行回写 `status`，`downstream_ref` 取最近一条 `accepted / linked` 回执里的快照（`source_ref.downstream`）。④ 阶段清单与转移规则是对合同 TS 常量的抄写，**单测把函数对每个（状态, 阶段）的输出展开成矩阵与合同常量对照**，漂了就红。⑤ 阶段（事件动词）不是请求状态，二者靠函数里的转移规则转换。

## 2. 事实核对（我今天读的，不是转述）
| 事实 | 出处 | 对设计的影响 |
|---|---|---|
| `authorization_decisions`：`verdict`（allow / require_approval / deny）、`decided_by`（policy / human）、`decided_by_user`、`expires_at`（= 政策的 `decision_ttl_seconds`）、**`consumed_at / consumed_by`（一次授权只能兑换一次执行）**、`action_run_id`、`client_id`；触发器只允许把 `consumed_at / consumed_by` 从空写成一次值；表上**没有撤销 `service_role` 的写权限** | `20260808000003_me2_execution_kernel_v1.sql:147-245` | 台账核验直接读它；**也意味着持钥者能直写它**（§0.4）；已兑换的决策不再看 `expires_at`（§4）|
| `action_runs`：`triggered_by`（signal / schedule / human / **agent** / run）、`triggered_by_ref`（自由文本）、`status`（含 `succeeded`）、`authorization_decision_id`、`execution_item_id` | 同上 `:267-345` | `fulfilled` 回读 `action_run` 时核 `client_id`、`triggered_by='agent'`、`triggered_by_ref = request_id::text`、创建时间（§6）|
| 内核的写函数都是 SECURITY DEFINER，并 `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated`；视图 `kernel_action_lineage` 用 `security_invoker` 且 `REVOKE ALL FROM PUBLIC, anon, authenticated`；内核函数的 `search_path` 是 `public` | 同上 `:521/561-563/714/887…`、`:1560-1606` | 本稿照抄，`search_path` 用更严的 `public, pg_temp`（§3.3）|
| 追加式触发器先例：`launch_signoff_events` 触发器拦 UPDATE / DELETE / **TRUNCATE**，并 `REVOKE UPDATE, DELETE, TRUNCATE FROM PUBLIC, anon, authenticated, service_role` | `20261019120000_launch_signoff_events.sql` | 照抄，并**再多撤销 INSERT**（它只撤了后三个）|
| `execution_items.status` 是枚举：`pending / in_progress / completed / skipped / superseded`；表上**没有**指向请求的列；**会被例行批量删除**（撤回营销计划删 pending 卡片、删处方 CASCADE）| `20260513000001_diagnostic_engine.sql:31`、`20260606000001…`、kernel 迁移 `:305-309` 注释 | 成功终态 = `completed`；要加回链列（§6）；下游会消失，所以要能重绑（`linked`）|
| `content_work_orders.status`：`queued … published / measuring / closed / failed / dead_letter / archived / superseded`；表上**没有**指向请求的列 | `20260711000002_p21j_content_factory_m1.sql:121-125` | 成功终态 = `published / measuring / closed`；要加回链列（§6）|
| RPC 缺失 fail closed 的现成工具 | `src/lib/kernel/rpc-versioning.ts::failClosedIfRpcMissing` | TS 外壳照用（§5）|
| 真 PostgreSQL 集成测试先例（默认跳过、设 DSN 才跑）与从零重放沙盘 `scripts/db-replay-and-verify.sh`：**沙盘里 `service_role` 只是个空角色（`:42`），没有任何默认授权**，拿它测“被拒”恒真 | `optout.integration.pg.test.ts`、脚本 | §9 要求测试先按 Supabase 默认授权给 `service_role`，再验证迁移的 REVOKE 生效 |
| 119 v0.4 §8 把接口定为 `ad_agent_apply_receipt(request_id, expected_old_status, new_status, receipt_seq, …)`：行锁、终态不可覆盖、乱序按序号、`downstream_ref = {kind, id, terminal_status}` 由 `markFulfilled` 回读写入、该函数**归 122 写** | 119 v0.4 §8 | 本稿对齐，**语义差异**见 §12 |
| 生产现状（沿用 v0.3，10-21 只读核对）：`action_runs` 4 行，全是人触发、全成功；还没有一条 agent 触发的真实运行 | v0.3 §2 | 内核同步器与 agent 触发的 run 都还是设计 |

## 3. 表与库内强制
### 3.1 `public.agent_request_receipts`（追加式，一行 = 一个阶段的回执）
| 字段 | 类型 / 约束 | 说明 |
|---|---|---|
| `receipt_key` | text **PK**，`^[0-9a-f-]{36}:[a-z_]+:[A-Za-z0-9._-]{1,64}$` | `<request_id>:<阶段>:<出现编号>`；**出现编号由生产者给**（§7）。同时是 Inngest 事件 id |
| `request_id` | uuid NOT NULL，FK → `ad_agent_requests(request_id)` **ON DELETE RESTRICT** | 回执不能先于请求存在，请求不能连台账一起被删 |
| `client_id` | uuid NOT NULL | **函数从请求行读，不接受调用方传入**；复合 FK `(request_id, client_id)`（要 119 给 `unique(request_id, client_id)`，§12）|
| `seq` | int NOT NULL，`unique(request_id, seq)` | 函数在**持有请求行锁时**取 max+1。只用于展示顺序；因果顺序由转移规则保证 |
| `stage` | text NOT NULL，CHECK 在合同阶段清单内 | `issued / accepted / linked / delivered / approval_requested / approved / rejected / executed / completed / failed / expired / reconciled / corrected` |
| `event_name` | text，**生成列** `'ad_agent.request.' \|\| stage` | 不单独存，免得和 `stage` 漂开 |
| `status_before` / `status_after` | text NOT NULL，CHECK 在八态内 | **由函数算出**，调用方不能传 |
| `actor` | text NOT NULL，CHECK 在封闭清单内：`ad_agent / video_agent / website_agent / seo_agent / kernel_sync / human / system` | 机器标识。**`actor` 只是标签，不是凭据**（§8 末）|
| `waiting_on` / `next_due_at` | text / timestamptz | 非终态必填；`next_due_at` 超过 `hard_deadline_at` 时**截断**到它（§8）|
| `approved_by` | text，CHECK `^(policy:[A-Za-z0-9._-]+\|human:[^@\s]+@[^@\s]+\|kernel:[0-9a-f-]{36})$` | `approved` 阶段必填；`human:` 的邮箱比对一律 `lower()` |
| `authorization_source` / `authorization_id` | text / **uuid**，两者同时为空或同时有值 | 授权的来源表名（白名单见 §4）与该表里的记录 id；**uuid 类型天然规范化**（大小写、连字符写法不同也是同一个值）；`approved` / `executed` 必填 |
| `no_publish` | boolean **NOT NULL** DEFAULT true | CHECK `(stage = 'executed') = (no_publish = false)`：只有“真上线 / 真改动”那一跳是 false |
| `cost_usd` | numeric(12,4) NOT NULL DEFAULT 0，CHECK ≥ 0 | 本跳 API / 生成成本，不含广告花费 |
| `provider_ref` | jsonb | `executed` 必须是**非空对象**：CHECK `stage <> 'executed' OR (jsonb_typeof(provider_ref)='object' AND provider_ref <> '{}'::jsonb)` |
| `source_ref` | jsonb | 本跳读到 / 产出的**指针**；`accepted / linked` 带 `downstream`（`{kind, id}` 快照，供重建缓存）；`reconciled` 必带 `window`，CHECK `source_ref->>'window' IN ('T+7','T+14')`；`corrected` 必带 `corrects`（被更正的 `receipt_key`）|
| `payload_hash` | text NOT NULL | 函数用规范 `jsonb` 文本算 SHA-256，**不接受调用方传入**；**只哈希业务身份字段**：阶段、`actor`、`approved_by`、授权来源 + id、`provider_ref`、`source_ref`、`cost_usd`——**不含** `waiting_on / next_due_at / note`（重试时它们可能重新算过，不该算冲突）|
| `note` | text，≤ 2000 字 | 一句话说人话 |
| `created_at` | timestamptz NOT NULL DEFAULT now() | 函数不接受调用方时间，表又没有写权限，所以不能倒填 |

唯一性 / 索引：`unique(request_id, seq)`；`(client_id, created_at desc)`；部分唯一索引 **`unique(authorization_source, authorization_id) WHERE stage = 'executed'`**（一个授权至多撑一次对外动作）与 **`... WHERE stage = 'approved'`**（一份批准至多批一条请求）；**`unique(request_id, (source_ref->>'window')) WHERE stage = 'reconciled'`**。

### 3.2 配套对象
- **`ad_agent_event_outbox`**：`receipt_key` PK + FK、`event_name`、`payload`（只带 `{client_id, request_id, receipt_key}`）、`created_at`、`emitted_at`。函数在写回执的**同一事务**里写一行；`emitted_at` 只能经 `ad_agent_mark_event_emitted_v1(receipt_key)` 从空变一次值（触发器管）。
- **`agent_request_heads`**（视图）：`ad_agent_requests` **LEFT JOIN LATERAL** 最新一行回执——**没有任何回执的请求也在里面**（`last_receipt_at` 为空，由监督函数按“发出后多久必须接单”判卡住）；带 `last_state_change_at` 与 `hard_deadline_at`（§8）。`WITH (security_invoker = true)`，`REVOKE ALL … FROM PUBLIC, anon, authenticated`，只给 `service_role` SELECT。
- **没有“规则数据表”**：转移规则、授权来源白名单都写在函数体里（预审 P0-1：放数据表里，`service_role` 默认能改）。改规则 = 改迁移 = A 级。

### 3.3 权限与触发器（真正的“唯一写入”）
| 对象 | `service_role` 能做什么 | 其它角色 | 触发器兜底 |
|---|---|---|---|
| `agent_request_receipts` | **只有 SELECT**（撤销 INSERT / UPDATE / DELETE / TRUNCATE）| anon / authenticated / PUBLIC：全撤 | BEFORE UPDATE OR DELETE（行级）与 BEFORE TRUNCATE（语句级）一律报错（先例 `launch_signoff_events`）|
| `ad_agent_event_outbox` | 只有 SELECT | 全撤 | UPDATE 只允许 `emitted_at` 空→一次值；DELETE / TRUNCATE 报错 |
| `ad_agent_requests`（119 的表，**本稿迁移追加**）| SELECT、INSERT；**撤销 UPDATE / DELETE / TRUNCATE** | 全撤 | BEFORE INSERT：`status` 必须是 `requested`、`downstream_ref` 必须为空；BEFORE UPDATE：`status / downstream_ref / updated_at` 变动时若 `current_user` 是 API 角色（`service_role / authenticated / anon`）则报错 |
| `execution_items.agent_request_id`、`content_work_orders.agent_request_id`（回链列，§6）| 照旧可写其它列 | — | BEFORE UPDATE：该列**只许从空写成一次**，改值或清空报错 |
| 函数 `ad_agent_apply_receipt_v1` / `ad_agent_mark_event_emitted_v1` | `GRANT EXECUTE` 给 `service_role` | `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` | 函数 `SECURITY DEFINER`、`SET search_path = public, pg_temp`；**触发器函数是 SECURITY INVOKER**，用 `current_user IN (API 角色)` 黑名单判断，不硬编码属主名 |

RLS：新表**启用 RLS 且不建任何策略**（`service_role` 本来绕 RLS，真正的控制是上面的权限与触发器；v0.3 里“不开 UPDATE/DELETE 策略”与“FOR ALL TO service_role”两句互相矛盾，**删掉**，不再把 RLS 当防线）。
**属主身份的 SQL 不受限**——迁移、Supabase SQL 编辑器、MCP 的 `execute_sql`（以属主身份跑）都不受上面这些权限与触发器约束，这是 DBA 通道，靠流程管（A 级、PM 显式 go），不靠这份设计。

## 4. 对外动作与授权（`approved` / `executed`）
- **授权来源白名单（写在函数体里）——v0.4 只放行 `authorization_decisions`（内核）**。其它来源（YouTube 一次性授权、执行看板的批准记录……）一律拒绝，待 74 / 105 / 121 定了创意链的批准落点后，作为一次 A 级迁移加进来，每个来源自带“绑定到本请求”的核验（§12(a)）。
- **`authorization_decisions` 的核验**（`approved` 与 `executed` 都做）：行存在 ∧ `client_id` = 请求的客户 ∧ `verdict = 'allow'` ∧ **决策所属的 `action_run`（`action_run_id`）满足 `triggered_by = 'agent'` 且 `triggered_by_ref = request_id::text`**（决策是为这条请求的执行签的）；`approved` 阶段另要求决策**未过 `expires_at` 或已被兑换**（已兑换的不再看过期，同步晚到不会被拒）；`executed` 阶段另要求 **`consumed_at` 非空**（真的被兑换执行过）。
- **不再要求 `executed` 的授权与 `approved` 的是同一份**：`dead_letter` 恢复 / 接管会重签决策，两跳可能不是同一个；改成“两跳的决策都属于本请求的 run”。一次性由 `executed` 上的部分唯一索引保证（一份授权至多撑一次 `executed`）。
- **`approved_by` 与授权记录里的“人”必须对得上**：`human:<邮箱>` 要求决策 `decided_by = 'human'` 且 `lower(decided_by_user)` = 该邮箱；`policy:` / `kernel:` 要求决策 `decided_by = 'policy'`。调用方单凭填一个邮箱冒充不了真人批准（但见 §0.4：持钥者能直写决策表）。
- **先批准后上线、先上线后完成**由转移规则保证：`executed` 只能出现在 `executing`（= 已 `approved`）之后，`completed` 之前必须已有 `executed` 回执。
- `approved_by` 三种格式：`policy:<策略编号>`、`human:<邮箱>`、`kernel:<authorization_decisions 的 id>`（内核同步器翻译过来的，只放指针）。**`human:` 的批准必须先有 `approval_requested`**（走 `pending_pm_approval`）；`policy:` / `kernel:` 可从 `accepted` 直接到 `executing`。

## 5. 唯一写入函数 `ad_agent_apply_receipt_v1`
### 5.1 签名与返回
`ad_agent_apply_receipt_v1(p_request_id uuid, p_stage text, p_occurrence text, p_expected_old_status text, p_actor text, p_waiting_on text, p_next_due_at timestamptz, p_approved_by text, p_authorization_source text, p_authorization_id uuid, p_cost_usd numeric, p_provider_ref jsonb, p_source_ref jsonb, p_downstream_ref jsonb, p_note text) returns jsonb`
返回 `{ outcome: 'inserted' | 'replayed', seq, status_before, status_after, receipt_key }`；失败抛带**机器可读码**的异常：`illegal_transition`、`stale_expected_status`、`receipt_key_conflict`、`authorization_invalid`、`downstream_invalid`、`readback_failed`、`request_expired`、`missing_next_due`、`request_not_found`。
**没有 `p_status`、没有 `p_client_id`、没有 `p_seq`、没有调用方时间**：新状态由函数算，客户从请求行读，序号函数自己取，`created_at` 是库的 `now()`。

### 5.2 一个事务里依次做（锁后幂等：重试一定得到 `replayed`，而不是 `stale` 或唯一冲突）
1. 校验参数形状（阶段在清单内、`p_occurrence` 符合格式、`p_actor` 在清单内）。拼出 `receipt_key`，算出 `payload_hash`。
2. **锁请求行**（`SELECT … FOR UPDATE`）；不存在抛 `request_not_found`。
3. **权威幂等检查（锁后）**：按 `receipt_key` 查已有回执。有 → 比 `payload_hash`：相同返回 `replayed`（带已有的 `seq / status_after`，不再写）；不同抛 `receipt_key_conflict`。因为已经持锁，原调用若还没提交，这次重试会在第 2 步排队，等它提交后才走到这里，必然命中 `replayed`；INSERT 仍兜住唯一冲突（读回已有行当 `replayed`）。
4. 比 `p_expected_old_status` 与当前状态，不同抛 `stale_expected_status`（调用方重读再决定）。
5. **转移规则**（函数体里的 `VALUES` 表，见 §5.3）：没有（当前状态, 阶段）这一行抛 `illegal_transition`。终态（`fulfilled / rejected / expired / failed`）只留 `fulfilled + reconciled`、`corrected`，其余阶段一律非法——**倒退、重放 `issued`、终态后再 `approved` 都在这里被拦**。附加守卫：
   - `approved`：请求未过 `valid_until`（否则抛 `request_expired`）；`accepted → executing` 只许 `approved_by` 是 `policy:` / `kernel:`；
   - `expired`：**必须真过了 `valid_until`**；且该请求**没有 `executed` 回执**、**没有已被兑换的授权决策**（它的 run 的决策 `consumed_at` 非空 = 执行已发生但回执可能还没落库）——否则拒绝；
   - `executed` / `completed` / `failed`：**不因时间拒绝**（真实发生的事必须能记下来）；
   - `completed`：必须已有 `executed` 回执；`launch` 类型本期不允许进入 `fulfilled`（§6）。
6. **阶段专属校验**（SQL 里做，不信调用方）：
   - `approved`：`approved_by` 与授权都要，按 §4 核验；
   - `executed`：`no_publish = false`、`provider_ref` 非空对象、授权按 §4 核验、部分唯一索引兜底；
   - `accepted` / `linked`：可带 `p_downstream_ref {kind, id}`，按 §6 核验后**同事务写入 `ad_agent_requests.downstream_ref`**（`executed` 之后不允许再改）；
   - `completed`：下游必须已绑定，库内回读（§6）；**回读失败整笔回滚**；
   - `corrected`：必带 `corrects`（同一请求下已存在的 `receipt_key`）与 `note`，不改状态，可用于终态后更正成本 / 备注 / 平台回执号（原行保留，展示与总成本以更正为准）；
   - 非终态结果必须有 `waiting_on` 与 `next_due_at`（`completed` 例外：带对账到期，§8）；`next_due_at` 超过 `hard_deadline_at` 时**截断**到它，不拒写。
7. `seq = 该请求当前最大 + 1`，写回执（含 `status_before / status_after`）。
8. 更新请求行：`status = status_after`、`updated_at = now()`（必要时 `downstream_ref`）。
9. 写发件箱一行（同事务）。
10. 返回。

TS 外壳 `appendAgentRequestReceipt()`（`src/lib/agent-requests/ledger.ts`）只做三件事：把参数整理好调 RPC；用 `failClosedIfRpcMissing` 在函数缺失时**当场停**（不退回历史入口）；调用成功后按发件箱发事件并调 `ad_agent_mark_event_emitted_v1`，发失败不影响已落库的回执（监督函数补发，§8）。**回读与核验都不在 TS 里做**。

### 5.3 转移规则（写在函数体里；阶段清单与映射以 119 合同为准，单测展开成矩阵对照）
| 当前状态 \ 阶段 | 之后的状态 |
|---|---|
| `requested` | `issued`→requested（仅第一条回执）；`accepted`→accepted；`rejected`→rejected；`failed`→failed；`expired`→expired |
| `accepted` | `linked`→同状态；`delivered`→同状态；`approval_requested`→pending_pm_approval；`approved`→executing（仅 policy / kernel 批准）；`rejected`；`failed`；`expired` |
| `pending_pm_approval` | `linked`、`delivered`→同状态；`approved`→executing；`rejected`；`failed`；`expired` |
| `executing` | `linked`（仅在还没有 `executed` 时）、`delivered`→同状态；`executed`→executing；`completed`→fulfilled（须已有 `executed`）；`failed`；`expired`（仅在满足 §5.2 第 5 步的守卫时）|
| `fulfilled` | `reconciled`→fulfilled（每个对账窗口至多一次）；`corrected`→fulfilled |
| `rejected / expired / failed` | 仅 `corrected`→同状态 |

另：**`corrected` 在任何状态下都合法**（不改状态，只更正已有回执的成本 / 备注 / 平台回执号 / 指针，必带 `corrects` 与 `note`）。

### 5.4 静态扫描降为辅助
仍保留“只有 `ledger.ts` 调这个 RPC”的全仓扫描，但**它不再是防线**：脚本、MCP、别的服务想绕过，库里没有写权限，直接被拒（属主身份 SQL 除外，§3.3）。

## 6. `fulfilled` 的回读（库内）与 `downstream_ref`
`ad_agent_requests.downstream_ref = {kind, id, terminal_status}`：
- **绑定**：`kind / id` 在 `accepted` 或 `linked` 回执里由函数写并核验；**`executed` 之前可以重绑**（执行卡被批量删、绑错了、换了新工单），每次绑定 / 重绑都是一行回执，可追溯；`executed` 之后锁死。**没绑定就 `completed` 不了**（fail closed），请求还能 `failed` / `rejected`。
- **绑定时的核验（防“把旧的已发布对象补写成本请求的下游”，预审 P0-4）**：对象存在 ∧ 客户一致 ∧ 回链列等于本请求（`action_run` 看 `triggered_by_ref`）∧ **对象创建晚于请求** ∧ **绑定那一刻对象还不在成功终态**。
- **回链列只许从空写成一次**（触发器，§3.3）——旧对象不能被改绑到新请求；错绑的对象就废在那儿，请求侧重绑另一个。
- **`terminal_status` 只在 `completed` 时由函数回读后写**，不接受调用方提供。`completed` 的 SQL 回读按 `kind`：

| kind | 回读条件（全部满足才放行）| 备注 |
|---|---|---|
| `action_run` | `action_runs.status = 'succeeded'` ∧ `client_id` = 请求客户 ∧ `triggered_by = 'agent'` ∧ `triggered_by_ref = request_id::text` ∧ `created_at ≥ 请求.created_at` | 魏征②的反例（指向别客户已成功的 run）在这里被拦 |
| `work_order`（`content_work_orders`）| `status IN ('published','measuring','closed')` ∧ `client_id` 一致 ∧ **`agent_request_id` = request_id** ∧ 创建晚于请求 | 工单表加**可空回链列** `agent_request_id uuid`（FK → `ad_agent_requests`，`ON DELETE RESTRICT`）|
| `execution_item` | `status = 'completed'` ∧ `client_id` 一致 ∧ **`agent_request_id` = request_id** ∧ 创建晚于请求 | 执行项表同样加回链列 |
| 其它 | **拒绝**（fail closed）| 新增 kind = 改迁移；page / seo 等没有 kind 的类型本期 `completed` 不了 |

- 这三条“成功终态”是我读两张表的状态枚举得到的（§2），**不是猜的**；回链列是纯增列，不改现有行为。
- `fulfilled` 的 CHECK（119 的表上）是 `status <> 'fulfilled' OR (downstream_ref ? 'kind' AND downstream_ref ? 'id' AND downstream_ref->>'terminal_status' IS NOT NULL)`；119 §8 的 CHECK 还要求 `terminal_status` 在“按 kind 约定的成功集合”内——**两者兼容，建议 119 用更强的那条**（§12）。
- **`launch`**：本期（W1）**不写、也不允许 `fulfilled`**——转移规则对 `launch` 类型不开放 `completed`；等 W2 为 `cron_run_log` 这个 kind 写出库内核验后再放开。体检 / 盯盘照旧只写 `cron_run_logs`。

## 7. `receipt_key`、重试与事件
- **出现编号（`<attempt>` 的替代）由生产者给，是业务编号，不是重试次数**：`delivered` 用草稿版本号（如 `draft-2`，来自工单自己的持久计数）；`executed` 用授权 id 的后缀；`linked` 用被绑对象 id 的后缀；其它一次性阶段用 `1`。**重试 / 重放用同一个编号**，所以幂等；**合法的第二次 `delivered`（两版草稿）编号不同**，所以不会被吞。
- 同键同载荷 → `replayed`（成本不会重复累计，因为根本没有新行）；同键异载荷 → `receipt_key_conflict`；**错写了怎么办 → `corrected` 更正回执**，不改原行。
- **发件箱**：回执与待发事件在同一事务落库；TS 外壳随后发事件（事件 id = `receipt_key`）并标记已发；崩在中间，监督函数每小时把 `emitted_at` 为空超过 10 分钟的补发。**发件箱不是安全边界**（`mark` 函数没法验证真发过），且 Inngest 按事件 id 去重只有约 24 小时——所以**所有消费者必须按 `receipt_key` 幂等**，补发多晚都不会重复触发下游。
- 119 的 `idempotency_key` 含“周期日”：**周期日取 NZ 日期**（写进合同）；`failed / rejected / expired` 之后同周期要能重发——这是请求表的事，建议带 `supersedes_request_id` 或把重发次数并进键；已列入 §12 给 119 的对齐项。

## 8. 监督函数 `ad-agent-request-watch`（每小时，新西兰 :35；`ad_agent.request_watch.requested` 可人手叫醒）
读 `agent_request_heads`，判四类（运行回执写 `cron_run_logs`，`summary = {checked, stalled, expired, unreconciled, outbox_resent, …}`；读不到请求表 = 函数自己失败，如实写 failed，不当成“没有卡住的”）：
1. **卡住**（非终态）：`next_due_at < now()`，**或** `now() > hard_deadline_at`（视图另带 `last_state_change_at`，只用来显示“在这个状态停了多久”）。
   - `hard_deadline_at = 请求.created_at + 该请求类型的最长全程`（常量：预算 3 天 / 受众 7 天 / 创意 14 天 / 页面 7 天 / SEO 14 天；可按请求覆盖但**不得超过 30 天**）；函数写 `next_due_at` 时**超过它就截断**（不拒写，免得挡住合法的迟到回执），所以反复追加“草稿已出”之类的无状态变化回执，**推迟不了“卡住”的判定**（魏征⑥）。
   - **没有任何回执的请求**（只在请求表、不在台账）：发出后 2 小时仍无 `accepted` → 卡住（它在 heads 视图里，不会隐形）。
2. **过期**：非终态且**真过了 `valid_until`**——
   - 没有 `executed` 回执、也没有已兑换授权 → 经函数追加 `expired`（`actor = system`；函数自己核 `valid_until`，监督函数只是发起方）；
   - **已有 `executed` 回执，或授权已被兑换（执行可能已发生）** → **不得转 `expired`**（函数拒绝）；改推一条红待办“该请求已上线（或已兑换）但已过有效期，请人决定是否停”，状态不动（魏征⑥：不能让链上显示过期而广告在跑）。
3. **已完成但缺对账**：`fulfilled` 且 `completed` 回执带的对账到期（T+7）已过、没有对应窗口的 `reconciled` → 待办（子牙4）。`completed` 回执在“终态”例外下允许 `next_due_at` = T+7、`waiting_on = reconcile_job`。
4. **发件箱漏发**：补发（见 §7）。
- 待办写法同 v0.3：what（“某某请求已 N 小时没回执，卡在谁”）/ how（点哪里、谁该做什么）/ href（W1 链路页）；同一请求同一状态一天一条。默认时限（写入者填 `next_due_at` 时用）：预算类批准后 2 小时 / 受众类 24 小时 / 素材类 72 小时出草稿、批准后 24 小时上线 / 页面类 48 小时 / SEO 类 7 天，**都受 `hard_deadline_at` 约束**。
- **`actor` 不是凭据**：任何依赖链上回执的闸（如 119 稿的 W2 “启用前网站回执”）**只认库内回读通过的 `fulfilled` + `downstream_ref`**，不认 `actor` 文本。
- 新 Inngest 函数合并后要有人对 `/api/inngest` 重新 Sync，不然“安静地不跑”；新增函数要登记 cron 登记表（机器判 A）。

## 9. W1 验收与测试
**W1 验收（唯一一条端到端链，与 119 稿同一条）**：诊断 → creative 请求 → `execution_items`（经 `/execution` + `promo_ref`）→ 视频 Agent（第一个客户的素材，上海团）→ 回执（本台账）→ T+7 对账。每一跳有回执（含成本、批准人、`no_publish`、平台回执号、下一步谁 / 最晚何时），链路页能画出来；`completed` 过了**库内回读**；T+7 出 `reconciled`。没真实跑通不叫做好，单测绿不能代替。**前置：§12(a) 的授权来源先定，否则这条链写不出 `executed`。**

**实现自带的测试（合并前必须绿；库内规则必须有真 PostgreSQL 测试，照 `optout.integration.pg.test.ts` 的写法）**：
- **测试库先按 Supabase 的默认授权给 `service_role / authenticated / anon` 建好角色和权限**（重放沙盘里 `service_role` 是空角色，不先授权，“被拒”恒真），再 `SET ROLE` 逐个试写：直接 INSERT / UPDATE / DELETE / TRUNCATE 回执表与发件箱、直接 UPDATE 请求表的 `status / downstream_ref`、改回链列的已有值 → 全部被拒；经函数路径写 → 成功。
- 转移矩阵：把函数对每个（状态, 阶段）的输出展开，与合同常量逐格对；终态后再 `approved`、`executing` 后重放 `issued`、已 `executed` 再 `expired`、没有 `executed` 就 `completed` → 都被拒。
- 授权：`executed` 缺授权 / 授权属于别的客户 / 决策所属 run 的 `triggered_by_ref` 不是本请求 / 授权未被兑换 / 同一授权第二次 `executed`（含 uuid 大小写写法不同）/ `no_publish = true` / `provider_ref = {}` / `human:` 邮箱与决策里的人对不上 → 全部被拒；`approved` 时决策已过期但已兑换 → 放行（每条一个用例，**当场对库试一次**）。
- 回读与绑定：`downstream_ref` 指向别客户已成功的 `action_run`、`triggered_by_ref` 对不上、`created_at` 早于请求、绑定时已是成功终态的旧工单、回链列指向别的请求、回链列被改写 → 被拒且库里什么都没变；`executed` 之前重绑成功、之后重绑被拒。
- 幂等与并发：同键同载荷重放 → `replayed`、一行、成本不重复；**两个并发的同键调用 → 一个 `inserted` 一个 `replayed`（不是 `stale`、不是唯一冲突）**；同键异载荷 → `receipt_key_conflict`；两版草稿（不同出现编号）→ 两行；事务中途失败 → 回执、请求行、发件箱都没写；同一请求两个并发不同阶段 → 串行化后按新状态判转移。
- 时间：`expired` 在 `valid_until` 之前被拒；已 `executed` 或授权已兑换的请求 `expired` 被拒；`executed` / `completed` 过了 `valid_until` 仍能写；`next_due_at` 超限被截断而不是拒写。
- 监督：造超时、超 `hard_deadline_at`、无回执、缺对账、发件箱漏发、已上线且过期各一条 → 各出对应待办 / 补发，补上后消失。
- 清单对照：阶段清单、八态、转移矩阵对照合同常量；静态扫描（辅助）。缓存重建：清掉请求行 `status / downstream_ref`，走重建入口按台账补回。

**先设计、不验收（W1 之外）**：其余请求类型；内核同步器（Inngest 只读扫 `action_runs where triggered_by='agent'`，翻译成台账行，**只放指针**，容忍悬空 `triggered_by_ref`）；`launch`（见 §6）；回填 CTS 10-20 开投那条链、回填内核那 4 条 run。

## 10. 分工 / 风险级 / Tier
| 谁 | 交付 |
|---|---|
| 119 | 合同目录（八态、阶段 / 事件名常量、转移规则矩阵、请求类型含 `launch`）+ `ad_agent_requests` 迁移（含 `unique(request_id, client_id)`）；广告 Agent 发 `issued`。**合同目录现在还不存在** |
| 122（我）| 台账迁移（随 PR，不在 PR 内 apply）：回执表与发件箱、函数与视图、权限与触发器、对 `ad_agent_requests` 的追加（INSERT / UPDATE 触发器与撤权）、`execution_items` / `content_work_orders` 回链列与“只写一次”触发器；TS 外壳；`chain.ts` + 接口；监督函数；测试（含真 PostgreSQL）。DeepSeek 分轮写，我审 |
| 105 | 推广计划页的链路展示（读 `chain.ts` 接口）|
| 106 / 121 / 95 | 各自流程里调写入函数发阶段回执；创建工单 / 执行项时写回链列 |
| 74 | 合同验收、W1 验收、与 PM 沟通；定 §12(a) |
**PR 顺序**：两边迁移分开 PR、互不夹带；**119 的 `ad_agent_requests` 迁移与合同先合并**，本台账迁移排在后面（有外键、要追加触发器与撤权）。
**风险级 A**：新表 + 新 SQL 写入函数 + 权限收口 + 新 Inngest 函数 + 对外动作授权核验 + `fulfilled` 回读。子牙 + 魏征复审一次、实施后一次；PM 回“合 N”才合并（钉签字 SHA），apply 迁移另要 PM 显式 go。写代码默认 DeepSeek；库内函数与权限这类 A 级核心，按 `CLAUDE.md §5` 例外可由我自己写，PR 里写明原因。
**Tier（Inline）**：归位 Kernel / Governance / Verification 基础设施，不新增支柱、不新增能力线；共享代码里不出现客户名 / 行业词（请求类型、字段中性命名）；时限常量是平台默认值，个别请求的差异走 `next_due_at`（受 `hard_deadline_at` 约束）。

## 11. 残余风险（诚实写明，库里管不到的）
- **持钥者伪造内核记录**：`service_role` 本来能直写 `action_runs`、`authorization_decisions`（内核就是这么写的），我们的核验读的正是它们——有钥匙又会伪造的人，可以造一条成功的 run 和一份已兑换的“人批准”决策，把链放行到 `fulfilled`。本设计防不住这个；要防得收口内核表的写权限（只许内核函数写），是内核 A 级事项（§12(b)）。台账能做到的是：**绕过函数直接改台账改不了**，**接线 / 代码错误造成的假回执写不进去**，并且每一步都留下可追溯的追加行。
- **平台回执号 `provider_ref` 的真伪库里验不了**（外部系统的东西）：库里只验“非空对象”。真伪靠：授权真实且一次性 → 下游对象库内回读成功 → T+7 `reconciled` 用平台读回核对。所以 `provider_ref` 是线索，不是证明。
- **属主身份 SQL 不受限**（迁移、SQL 编辑器、MCP 的 `execute_sql`）：这是 DBA 通道，靠流程（A 级、PM 显式 go）管。
- 阶段清单 / 转移规则 / 合同常量三处抄写，漂开只能靠矩阵对照单测发现；合同目录落地前本稿的映射是草案。
- 本稿所有规则在迁移 apply 之前都是纸面设计；A 级，apply 要 PM 显式 go，且先在一次性的测试库里把 §9 的用例跑一遍。

## 12. 给 119 的对齐项 与 剩余待办
**与 119 v0.4 §8 的差异（请她确认；其余语义全部沿用）**
1. 函数入参：119 稿是 `new_status` + `receipt_seq`；本稿改成 **`stage` + 函数体里的转移规则**（子牙2 / 魏征④ / 预审 P0-1 都要求“库里算，不信调用方，规则不放可改的表里”）。保留的：`expected_old_status`、行锁、终态不可覆盖、乱序不倒退（由转移规则保证）。`receipt_seq` 由函数在持锁时取，不由调用方给。
2. `downstream_ref`：沿用 `{kind, id, terminal_status}`，但 `kind / id` 在 `accepted` 或 `linked` 回执时由函数写并核验（`executed` 前可重绑），`terminal_status` 只在 `completed` 回读后由函数写，**调用方一概不提供**。CHECK 建议用 119 的更强版（`terminal_status` 属于按 kind 约定的成功集合），本稿的是其子集，兼容。
3. `ad_agent_requests` 要加：`unique(request_id, client_id)`；BEFORE INSERT 触发器（`status` 必须 `requested`、`downstream_ref` 为空）；撤销 service_role 的 UPDATE / DELETE / TRUNCATE（这几条我在台账迁移里追加，她的迁移先合并即可）。
4. 幂等键：周期日取 **NZ 日期**写进合同；`failed / rejected / expired` 之后同周期重发的办法（`supersedes_request_id` 或把重发次数并进键）。
5. `valid_until`：默认值与语义——过期 = 追加 `expired` 回执，**但已有 `executed` / 授权已兑换的请求不得过期**（本稿 §5.2、§8）；`approved` 须在 `valid_until` 之前。
6. `launch`：本期不写台账行、不允许 `fulfilled`；W2 再定 `cron_run_log` 这个 kind 的库内核验。
7. 合同里“纯建议类”请求类型（无对外动作、可不经 `executed` 完成）目前**不存在**——本稿对所有类型一律要求 `completed` 前有 `executed`；合同日后定义了再单独放开。

**剩余待办**
- **(a)【阻塞 W1】创意链的授权来源**：上海素材的“批准 → 上线”那一跳，批准记录落在哪张授权表？候选：内核 `authorization_decisions`（若上线动作走内核）、`youtube_publish_authorizations`（YouTube 一次性授权）、或为创意链新建一张一次性授权表。需 74 / 105 / 121 拍板；定了之后加进函数体的来源白名单，并为它写“绑定到本请求”的核验（一次 A 级迁移）。在此之前创意请求写不出 `executed`。
- **(b)** 内核表收口：`action_runs` / `authorization_decisions` 的写权限只留给内核函数（§11 第一条）。内核 A 级卡，PM 定，不在本稿范围。
- (c) 工单 / 执行项回链列 `agent_request_id` 的写入点：由创建它们的代码（106 / 121 / 执行看板）在创建时写，需各自 PR。
- (d) 合同目录落地后，对照阶段清单与转移矩阵，更新 §5.3。
- (e) 各请求类型 `hard_deadline_at` 的数值（§8 第 1 条：预算 3 天 / 受众 7 天 / 创意 14 天 / 页面 7 天 / SEO 14 天，上限 30 天），请 74 / 119 复核。
