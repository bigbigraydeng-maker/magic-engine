# 广告智能体系：「动作请求 → 回执」追踪与回执表设计（v0.7，只设计，不写代码）

日期 2026-10-21 ｜ 起草：122 号（追踪与回执）｜ 要求方：74 号 ｜ 状态：草案 v0.7——并入子牙 + 魏征对 v0.6 的复审（高 3 条、中 5 条、附注 2 条，74 号 10-21 转来）与 74 号对三件事的拍板；**取代 v0.6**；复审结论是“台账底座（回执表 / 函数 / 触发器 / 权限）可先动工，观察型链和 W1 验收等 v0.7”——本稿改的几乎都在观察型链（§4 §5.2 §6 §8 §9）；待两位只看增量的复审 + PM 点头（新表 = A 级，apply 迁移要 PM 显式 go）
依据：74 号架构稿 `docs/specs/2026-10-21-ad-agent-system-v1-architecture.md`；119 号 `docs/specs/2026-10-21-ad-agent-kernel-side-design-v0.4.md`（§8 定了 `ad_agent_apply_receipt` 的语义，点名归 122 写）与 `docs/specs/2026-10-21-ad-creative-link-registration-design-v0.1.md`（PR 2990，广告↔成片补链）；v0.3 / v0.4 / v0.5 / v0.6（本分支，保留作历史；**各版本的对账表在各自稿开头**，本稿不重复）。
事实核对（§2）基于仓库 `9acaf9b45` 的迁移与代码，2026-10-21 当天逐条重读；标「子牙查实 / 魏征查实 / 119 查实」的几条来自复审或同伴的只读核对，我已对照迁移或代码复核。v0.6 起新增的几条（盯盘快照表、广告↔成片关联表、审核记录、对账日数据表）还对生产库做了只读核对（行数 / 最新时间），数字写在 §2。

## 变更记录 v0.6 → v0.7（复审意见逐条对账）
**74 号 10-21 对三件事的拍板（先于审查意见）**
| 事 | 决定 | 在本稿的落点 |
|---|---|---|
| 创意类广告建出来时写“广告↔成片”关联行（v0.6 的新前置条件）| **owner = 119**（广告 Agent 内核侧，含广告创建路径）；因为 74 用 Meta 工具手建的广告绕过 ME，119 还要做一个“登记 广告↔视频 / 工单”的受限入口；设计在 PR 2990；落地前 W1 的 `observed_live` 那一段如实报“没过”，不放宽 | §10 ②'、§12(f) |
| 验收怎么验 | 沙盘用拷贝重排时间跑通、生产首条走新请求；存量回填（10-20 那批）另设计“回填请求”，A 级、等 PM go | §9、§12(g) |
| 工单批准有两条路 | PM 只在 ME 审核页批准（10-20 SH3 就是在审核页批的），没有迹象还在 Airtable 批；观察型 `approved` 只收 ME 审核路由，Airtable 路径批的停在 `pending_pm_approval` | §4、§12(e) |

**【高】（子牙 + 魏征，对 v0.6）**
| 意见 | v0.7 的处理 | 章节 |
|---|---|---|
| 1. **批准后可换下游绕过人批**：转移表允许 `executing` 下继续 `linked`；`approved` 记的是工单 A，`observed_live` 不要求当前下游 = 被批的工单 | ①观察型 `approved` 之后**下游锁死**（`executing` 下 `linked / delivered` 都抛 `illegal_transition`；要换片 = 新开请求）；②`observed_live` 强制 `downstream_ref.id` = `approved` 回执 `source_ref.approval.id`，并对**当前**下游的 `review_ref` 把批准人核验重做一遍（`approval_downstream_mismatch`）| §4 §5.2 §5.3 §6 |
| 2. **批准人闸只在 TS 层**：`VerifiedReviewer` 是编译期品牌；库里只比 `review_ref.approved_by` 与入参邮箱；ME 审核路由和 Airtable 同步写同样的键，分不出来源 | ①审核路由在 `review_ref` 加**不可省**的 `approval_source = 'me_review_route'` 与 `approver_scope`（来自 `requireGlobalAdmin`，必须是 `global_admin`）；②函数把这两项当必需条件（`approver_source_invalid`）；③`review-sync.ts` 显式写自己的 `approval_source = 'airtable_sync'`，永不写路由那个值；④§11 如实降级——标记能区分**代码路径**，防不住持钥者改写 jsonb，不写成“已强制”；⑤新增一个前置小 PR（§10 ②''）| §4 §10 §11 |
| 3. **观察到的广告没对上请求合同**：观察者按 `created_at` 升序第一条过关就认领，没比对账户 / 系列 / 广告组 / 预算；同帖子可被多次投；1 美元测试广告能抢先认领 | ①`creative` 合同写**目标** `target = {ad_account_id, campaign_id, adset_id}`（请 119 在合同里给），`observed_live` 核验比对：快照的账户 / 系列 / 广告组必须等于合同目标（`observation_target_mismatch`）；②同一成片在目标广告组里有**不止一条**通过核验的在投广告 → **不自动选**（`observation_ambiguous`），监督函数出“指认”待办，由人指认（`actor = human` + `approved_by`，同样整套重核）| §4 §5.2 §8 |

**【中】**
| 意见 | v0.7 的处理 | 章节 |
|---|---|---|
| 4. **对账信号太弱**：`match` = 窗口内花费合计 > 0，第一天花 5 美元第二天被停也 `match`，§11 “能发现广告被停”不成立；接续次数 / 间隔只在监督函数里；`match` 链头可被后来的 `mismatch` 覆盖；窗口时区来源没写 | ①`match` 改成“**窗口末仍在投**”：窗口最后 2 个日历日里这条广告有花费 **且** 最新快照仍是 `ACTIVE`，否则（数据已拉全）`mismatch`；②`match / mismatch` 链头是**终局**，只有 `unmeasurable` 能被接续；③接续间隔（≥ 24 小时）与条数（≤ 5）**下沉到函数**（`reconcile_chain_limit`）；④窗口按**广告账户的时区**算（取账户级快照的 `timezone_name`；读不到 = `unmeasurable`，不猜、不退回 UTC）——ME 没有客户级时区配置，账户时区才是日数据 `insight_date` 的口径 | §5.2 §8 §11 |
| 5. **`ad_creative_links` 可被 upsert 覆盖**：`persistLink` 的 `onConflict` 重写 `creative_ref / link_method`，观察通过后重投可把证据改成 `unresolved`；“广告晚于请求”用关联行 `created_at` 不可靠 | ①对 119 的表提硬要求：**解析成功的行写一次不可改**（触发器，§12 第 11 条）；②“广告晚于请求”改用该广告在 `ad_entity_snapshots` 里**最早一行**的 `captured_at` 与请求 `created_at` 比（回填 / 重写都会改关联行的 `created_at`）；③观察通过时把 `link_id / link_method / creative_ref` 冻进 `provider_ref` | §4 §12 |
| 6. （子牙）`ad_creative_links` 今天走不通，且 ME 内没有“自建创意广告”入口；请放宽到“内容绑定类 `link_method`”并与 119 的 PR 2990 对齐；过渡可查 `creative_video_ids` 匹配工单视频 id，明写较弱证据，并查工单是否存视频 id | ①观察核验认**两种内容绑定类**：`published_post_id`（帖子 id 精确命中）与 `asset_binding`（广告创意视频 → 素材池条目 → 工单，PR 2990 §1），`unresolved` 一律不放行；`provider_ref.link_strength` 如实标 `post_id` / `asset_pool_title`；②**过渡路线查过，不可用，不写**：工单 `published_ref` 存的 `post_id / video_id` 是主页上的 Reel 草稿，广告里用的是广告账户视频库里的另一个视频对象，119 实测 10 个 id × 118 条工单 0 命中（§2 新增一行）| §2 §4 §11 §12 |
| 7. 沙盘第一段不是“真实事实”（生产关联行不存在）；W1 应拆 W1a / W1b | 第 1 段改叫**合成夹具**（按真实表结构造的虚构数据，不是真实数据的拷贝）；W1 拆 **W1a**（`issued → … → approved`，不依赖关联表和快照，先验）与 **W1b**（`observed_live → … → reconciled`，卡在 PR 2990），W1b 另开台账卡 | §9 |
| 8. `corrected` 第③类（改 `source_ref` 里的指针）可事后改写 `approved / observed_live` 的证据指针且不重核 | 删掉第③类；`corrected` 只剩：备注、成本（显式给才替换）、结案标志、更换观察对象（整套重核）| §5.2 |

**【附注】**
| 意见 | v0.7 的处理 | 章节 |
|---|---|---|
| 常驻核对加 `pg_trigger.tgenabled`，防 `DISABLE TRIGGER` | `ad_agent_ledger_security_check_v1()` 加“本稿所有触发器必须启用”一项；测试加“触发器被禁用 → 红待办” | §3.3 §8 §9 |
| “成功终态”对工单的定义要写明（§6 与 §4 的说法对不上）| §6 新增一行定义两个集合：**批准后集合** = `approved / publishing / published / measuring / closed`（`approved` 与 `observed_live` 核验用）；**成功终态** = `published / measuring / closed`（绑定那一刻已在其中 = 旧对象，不许绑）| §6 |

## 0. 一段话结论
1. **不重造**：授权 / 执行 / 步骤 / 成本 / 校验的系统记录仍是**内核**（`action_runs`、`authorization_decisions`、`action_run_steps`、视图 `kernel_action_lineage`）；盯盘 / 体检的运行回执仍是 `cron_run_logs`；请求本身仍归 119 的 `ad_agent_requests`。这三样一个字都不搬。
2. **只新增一张追加式「请求回执台账」`agent_request_receipts`**（+ 一张事件发件箱 `ad_agent_event_outbox`）。W1 链路页读「119 的请求表 + 这张台账」就能画出“从发出到有回执”。
3. **防线在库里，不在自觉里**：两张新表对 `service_role` 没有写权限，写入只有一条路——SECURITY DEFINER 函数 `ad_agent_apply_receipt_v1`。函数在一个事务里：先锁请求行、再幂等、再按**函数体里的转移规则**算新状态、再在库内核验授权与下游、最后写回执 + 同事务更新请求行缓存 + 写发件箱。调用方给不了“结论”，只能给“阶段 + 证据”。
4. **两种模式**（函数体里按请求类型定，改它 = 改迁移 = A 级）：**观察型**（本期 `creative`）——台账只记“谁做了什么、人批了什么（指针当证据）、我们观察到了什么”，**从不声称授权或执行**，用 `observed_live` 收尾，终态词是 **`fulfilled_observed`，展示成“观察到在投”，不写“已上线”**；**创意上线不受内核授权覆盖、也没有任何阻断——已经被人手动上线的广告（成片须已在 ME 审核页批准、内容绑定对得上、且落在请求合同指定的广告组）同样会拿到 `fulfilled_observed`**；**执行型**（其余类型，等内核动作落地）——授权、执行、回读全按 §4 §6 核验，用 `executed → completed` 收尾，终态词 `fulfilled`。W2 的任何“启用前闸”只认执行型的 `fulfilled`，**永远不认 `fulfilled_observed`**。
5. **这套防线防什么、不防什么（写明白）**：防——其它窗口 / 脚本 / MCP 绕过函数直接改台账、代码或接线出错造成的假回执、重放与并发、倒退状态、抢先占位。**不防**——持有 `service_role` 钥匙、**又去伪造系统记录**的人：内核的 `action_runs`、`authorization_decisions`，以及观察型要读的盯盘快照行、广告↔成片关联行、审核记录、日数据，本来都是 `service_role` 可写的，我们核验时读的正是它们；也不防“人点了执行卡完成”这种可变状态被当成成功证据（§11）。收口那些表是各自的 A 级事项，另开卡由 PM 定（§12(b)）。
6. **内核一行代码不改。** 请求编号借内核现成的 `triggered_by='agent'` + `triggered_by_ref` 带过去。
7. **“没回执 / 没对账 / 权限被改”有人管**：每小时的监督函数扫卡住、过期（仅限未上线的）、已完成但缺对账、对账不一致、发件箱漏发、**表权限被人改了 / 属主名下多了能写台账的函数**，推今日待办（what / how / href）；观察者（actor `ad_watch`，写 `observed_live`；符合条件的广告多于一条时不自动选，出“指认”待办交人）与对账者（actor `reconciler`，写 `reconciled`）也是这个函数里的步骤（§8）。

## 1. 分工（一个事实一个家）
| 事实 | 唯一的家 | 谁写 |
|---|---|---|
| 请求是什么：`request_id`、`client_id`、`request_type`、合同正文、`idempotency_key`、`valid_until`、`created_by`、`created_at` | 119 的 `ad_agent_requests` | 广告 Agent / 合同代码（119）创建一次；之后不再改 |
| 当前到哪了：`status`、`downstream_ref`（`{kind, id, terminal_status}`）、`observed_ad_id`（观察型收尾时认领的广告号，部分唯一）、`updated_at` | `ad_agent_requests`（台账最新状态的**缓存**）| **只有 `ad_agent_apply_receipt_v1` 能改**（§3 的权限 + 触发器强制）|
| 每一步发生了什么：阶段、前后状态、谁做的、谁批的、成本、`no_publish`、授权、平台回执号、下一步谁 / 最晚何时 | **本稿** `agent_request_receipts`（追加式）| 同一个函数 |
| 授权理由、步骤产物、校验结果、内核动作的成本（内核管的那几跳）| 内核 `kernel_action_lineage` | 内核（不动）。**内核同步器写的台账行只放指针**（`source_ref.action_run_id`、授权的来源 + id），**`cost_usd` 为 0**，不复制内核的状态、批准人、成本 |
| 体检 / 盯盘 / 监督函数的运行回执 | `cron_run_logs` | 各 Inngest 函数（不动）|

规则：① 台账**不存**合同正文、请求类型、当前状态；119 的表**不存**回执、成本、批准人、`no_publish`、授权、平台回执号。② 台账的前后状态与 119 表的 `status` 取值**完全同一套**（合同**九态**：原来的八态 + `fulfilled_observed`）。③ 缓存可重建：修复入口按每个 `request_id` 取 `seq` 最大的一行回写 `status`，`downstream_ref` 取最近一条 `accepted / linked` 回执里的快照（`source_ref.downstream`），`observed_ad_id` 取最近一条 `observed_live`（或“更换观察对象”的 `corrected`）回执里的 `provider_ref.ad_id`。④ 阶段清单与转移规则是对合同 TS 常量的抄写，**单测把函数对每个（模式, 状态, 阶段）的输出展开成矩阵与合同常量对照**，漂了就红。⑤ 阶段（事件动词）不是请求状态，二者靠函数里的转移规则转换。⑥ **同一动作的成本只记一处**：生产者的生成成本记在台账（如视频 Agent 的 `delivered` 行）；内核动作的成本只在内核；台账总成本 = 台账行之和，内核成本单列展示、**不相加**。⑦ **函数派生的值不收调用方的**：观察型的 `provider_ref`、对账的 `result / evidence` 都由函数从系统表读出来写，调用方只给指针 / 窗口名。

## 2. 事实核对（我今天读的，不是转述）
| 事实 | 出处 | 对设计的影响 |
|---|---|---|
| `authorization_decisions`：`verdict`、`decided_by`（policy / human）、`decided_by_user`、`expires_at`（= 政策的 `decision_ttl_seconds`）、**`consumed_at / consumed_by`**、`action_run_id`、`client_id`；触发器只允许把 `consumed_at / consumed_by` 从空写成一次值；表上**没有撤销 `service_role` 的写权限**。**`consumed_at` 是 run 被领走时就写的（子牙查实）——已兑换只说明动作开始，不说明成功** | `20260808000003_me2_execution_kernel_v1.sql:147-245` | 核验直接读它；持钥者能直写它（§0.5）；已兑换的不再看 `expires_at`；`executed` ≠ 成功，成功只认 `completed` 回读（§4）|
| `action_runs`：`triggered_by`（signal / schedule / human / **agent** / run）、`triggered_by_ref`（自由文本）、`status`（queued / authorizing / authorized / pending_approval / denied / running / **succeeded** / failed / dead_letter / superseded）、`authorization_decision_id`、`action_key`、`execution_item_id`；内核自己有 `action_key_mismatch` 校验（魏征查实）| 同上 `:267-345` | `executed` 核 run 为 running / succeeded 且 `action_key` 在请求类型白名单内；`completed` 核 succeeded（§4 §6）|
| 内核的写函数都是 SECURITY DEFINER，并 `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated`；视图 `kernel_action_lineage` 用 `security_invoker` 且 `REVOKE ALL FROM PUBLIC, anon, authenticated`；内核函数 `search_path` 是 `public` | 同上 `:521/561-563/714/887…`、`:1560-1606` | 本稿照抄，但 `search_path` 收到空串、函数体全限定（§3.3）|
| 追加式触发器先例：`launch_signoff_events` 触发器拦 UPDATE / DELETE / **TRUNCATE**，并 `REVOKE UPDATE, DELETE, TRUNCATE FROM PUBLIC, anon, authenticated, service_role` | `20261019120000_launch_signoff_events.sql` | 照抄，并**再多撤销 INSERT** |
| `execution_items.status` 枚举：`pending / in_progress / completed / skipped / superseded`——**人可以点“完成”**；没有指向请求的列；会被例行批量删除 | `20260513000001_diagnostic_engine.sql:31`、`20260606000001…`、kernel 迁移 `:305-309` 注释 | 成功终态 = `completed`，但这是**可变状态**（§11）；要加回链列；下游会消失，所以要能重绑（`linked`）|
| `content_work_orders.status`：`queued … approved … published / measuring / closed / failed / dead_letter / archived / superseded`；**没有 `approved_by / approved_at` 列**（子牙查实），但审核流程把批准人和时间写进 **`review_ref`（jsonb）**（见本表末尾“审核记录”一行）；没有指向请求的列 | `20260711000002_p21j_content_factory_m1.sql:121-125` | 工单状态只能当“进度”证据，不能当授权记录；要加回链列 |
| 素材池 `creative_pool` 里条目的批准：`approved_by` 是 jsonb 数组字段，无行 id、无一次性语义（子牙查实）| 素材池读写代码 | 不能当授权来源；观察型的内容批准只记指针当证据（§4）|
| RPC 缺失 fail closed 的现成工具 | `src/lib/kernel/rpc-versioning.ts::failClosedIfRpcMissing` | TS 外壳照用（§5）|
| 真 PostgreSQL 集成测试先例与从零重放沙盘 `scripts/db-replay-and-verify.sh`：沙盘里 `service_role` 只是个空角色（`:42`），没有默认授权，拿它测“被拒”恒真 | `optout.integration.pg.test.ts`、脚本 | §9 要求测试先按 Supabase 默认授权给 `service_role`，再验证迁移的 REVOKE 生效 |
| 119 v0.4 §8：`ad_agent_apply_receipt(request_id, expected_old_status, new_status, receipt_seq, …)`，该函数**归 122 写** | 119 v0.4 §8 | 本稿对齐，**语义差异**见 §12 |
| 生产现状（10-21 只读核对）：`action_runs` 4 行，全是人触发、全成功；还没有一条 agent 触发的真实运行 | v0.3 §2 | 执行型是设计；W1 只跑观察型 |
| 审核记录：ME 审核路由 `POST /api/factory/work-orders/[id]/review` 经 `guardAdmin()` + `requireAdmin()`，批准人 = 已验证会话的邮箱，`applyApprove` 把 `approved_by / approved_at / checklist_human` 写进工单 `review_ref`；**另有 Airtable 同步路径**（`review-sync.ts::applyApprove`），批准人取自 Airtable 字段邮箱，取不到记 `'unknown'`，写同样的键——**库里分不出这条批准是从哪条路径来的**（v0.7 加来源标记，§4）。`requireAdmin` 只判 `role = 'admin'`，**连限定在单个客户的演示管理员（DEMO_ADMINS）也放行**；“内部员工”的唯一判据是 `requireGlobalAdmin`（`ADMIN_EMAILS / ADMIN_EMAIL_DOMAIN`，无客户限定）| `src/app/api/factory/work-orders/[id]/review/route.ts`、`src/lib/factory/review-apply.ts:88-103`、`src/lib/factory/review-sync.ts:211-228`、`src/lib/auth/require-admin.ts` | 批准人**有库内记录但可变**，且两条路径可信度不同：观察型 `approved` 只收 ME 审核路由 + `requireGlobalAdmin`，并让函数核对 `review_ref`（§4）|
| 盯盘快照：`ad_entity_snapshots`（广告级行：`entity_id` = 广告号、`effective_status`、`captured_at`、`client_id`、`ad_account_id`）与 `ad_snapshot_captures`（每轮每账户每层级是否抓全 `complete`、是否共用账户跳过 `skipped_shared`）。**广告级行只在设置变化时记一行、另每天一次**；抓取任务 `ad-entity-snapshot` 在 `render.yaml` 里是每 6 小时一轮（`30 */6 * * *`；`registry.ts` 登记的是 `*/3`，不一致）。**生产只读核对（10-21）**：表在、广告级 4408 行、最近一轮 10-20 12:31 UTC（CTS 广告级抓取 00:31 / 06:31 / 12:30 三轮都在、都抓全）；近 36 小时里 ACTIVE 的广告 21 条；`service_role` 可写 | `20260914000001_ad_entity_snapshots_and_video_metrics.sql`、`render.yaml:1166-1181`、`src/lib/cron/registry.ts:115` | 观察型 `observed_live` 的证据只认这里（§4）；“最新一行 ACTIVE”要配合“同账户 12 小时内有一轮抓全”才能说“现在还是”；共用账户只记账户级；库里验不了它的真伪（§11）|
| 盯盘快照表的列（读迁移）：广告级行（`level = 'ad'`）带 `ad_account_id / campaign_id / adset_id`；预算 `daily_budget_minor` 在**系列 / 广告组行**上（`budget_level` 标明挂在哪一层），广告级行没有；账户级行（`level = 'account'`）带 `timezone_name`；**没有“广告创建时间”列**（只有 `captured_at`）| `20260914000001_ad_entity_snapshots_and_video_metrics.sql:31-100` | 合同目标（账户 / 系列 / 广告组）能直接在快照行上比对（§4 第 3 条）；对账窗口的时区取账户级行的 `timezone_name`（§5.2）；“广告晚于请求”只能用该广告最早一行快照的 `captured_at` 近似（§4 第 4 条）|
| 广告 ↔ 成片：`ad_creative_links`，**建广告那一刻**写（`ad_id`、`post_id`、`creative_ref` = 工单 id、`link_method` = `published_post_id` / `unresolved`），唯一键 (client_id, platform, ad_id)。**生产只读核对（10-21）：全表 4 行、0 行解析成功（`creative_ref` 全空），最近一行 10-08，全是 `winner_reel_sync` 写的；上一行里那 21 条在投广告一条关联行都没有**。代码里**只有 `winner_reel_sync` 一个调用点**（`src/lib/winner-reel-sync/engine.ts:288` 调 `linkAdToCreative`）；`boost_post_api` 在 `AdCreationPath` 里登记了，但全仓没有调用点；创意类广告的建广告入口也不写（`creative-link.ts` 注释“待加 me_ad_launch”）；在 Meta 后台 / 工具里直接建的广告当然更不写；`persistLink` 是 `upsert`（`onConflict: client_id,platform,ad_id`），**整行覆盖** `creative_ref / link_method`——已解析的行会被后来的 `unresolved` 写入改掉（魏征 v0.6 复审，代码 `creative-link.ts:233-251`）| `20260801000001_ad_creative_links.sql`、`src/lib/ads/creative-link.ts:48-57`、`src/lib/winner-reel-sync/engine.ts:288` | **“广告对得上被批准的成片”今天一条都过不了**——观察型的新前置条件（§10 ②'）|
| 119 的 PR 2990 查实（10-21，只读核对 CTS 118 条工单）：一条内容在系统里有**三个互不相同的 id**——①工单发布的主页 Reel 草稿（`published_ref.post_id = video_id`）；②74 上传到广告账户视频库的素材视频（素材池条目的 `ref`）；③广告创意里 Meta 生成的衍生视频 / 帖子（素材池条目的 `alias_refs`）。素材池 5 个 id + 衍生 id 共 10 个，在 118 条工单的 `published_ref` / `output` 里**全文搜索 0 命中**，所以手建广告永远满足不了“帖子 id 精确命中”。可用的内容绑定链是：广告创意视频 id ∈ 素材池条目（`ref ∪ alias_refs`）→ 条目新增的 `work_order_ref`（受限入口写：读 Meta 核对“视频存在 / 标题含工单 id 前 8 位 / 时间在工单之后 / 同一工单只绑一个条目”）→ 工单 | `docs/specs/2026-10-21-ad-creative-link-registration-design-v0.1.md`（PR 2990）§0 §1 §2 | 观察核验认两种内容绑定类 `link_method`（§4 第 4 条）；“创意视频 id 匹配工单视频 id”的过渡路线对手建广告过不了，不写（§12）|
| 对账用的日数据：`ad_daily_insights`，唯一键 (client_id, platform, level, entity_id, insight_date)；**生产只读核对（10-21）**：level = campaign 487 / adset 306 / **ad 1040** 行，最新 `insight_date` = 10-19 | `20260721000001_ad_daily_insights.sql` | 观察型 T+N 对账的取数源（§5.2 `reconciled`）；一条广告有没有 ad 级日数据，要在 W1 验收第 1 段核对（§9）|

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
| `status_before` / `status_after` | text NOT NULL，CHECK 在**九态**内 | **由函数算出**，调用方不能传 |
| `mode` | text NOT NULL，CHECK 在 `observed` / `executed` 内 | **函数按请求类型填，调用方不能传**；同一请求所有回执的 `mode` 相同。观察型 / 执行型的差别（§4）在行上直接可见，不靠“看 `no_publish` 猜” |
| `actor` | text NOT NULL，CHECK 在封闭清单内：`ad_agent / video_agent / website_agent / seo_agent / kernel_sync / ad_watch / reconciler / human / system` | 机器标识。`ad_watch` = 观察者（写 `observed_live`；符合条件的广告多于一条时改由 `human` 指认，§4），`reconciler` = 对账者（写 `reconciled`）。**每个阶段允许哪些 `actor` 写死在函数体里（§5.2 末的表）**；`actor` 只是标签，不是凭据（§8 末）。CHECK `actor <> 'kernel_sync' OR (source_ref ? 'action_run_id')`：内核同步器的行必须带 `action_run_id` |
| `waiting_on` / `next_due_at` | text / timestamptz | 非终态必填；`next_due_at` 超过 `hard_deadline_at` 时**截断**到它（§8）|
| `approved_by` | text，CHECK `^(policy:[A-Za-z0-9._-]+\|human:[^@\s]+@[^@\s]+\|kernel:[0-9a-f-]{36})$` | `approved`、`corrected`、以及**由人指认的 `observed_live`** 必填（`actor = ad_watch` 的 `observed_live` 必须为空）；`human:` 的邮箱比对一律 `lower()`；**观察型的 `approved` 只许 `human:`，`corrected` 与指认的 `observed_live` 也只许 `human:`** |
| `authorization_source` / `authorization_id` | text / **uuid**，两者同时为空或同时有值 | 授权的来源表名（白名单见 §4）与该表里的记录 id；uuid 类型天然规范化。**执行型**的 `approved` / `executed` 必填；**观察型的 `approved / observed_live` 必须为空** |
| `no_publish` | boolean | **执行型**：NOT NULL，CHECK `(stage = 'executed') = (no_publish = false)`——只有“真上线 / 真改动”那一跳是 false。**观察型：恒为 NULL（不适用），不借用这个字段**：观察型的行既不是“我们没发布”，也不是“我们发布了”（广告可能是人手动上线的）。CHECK `(mode = 'executed') = (no_publish IS NOT NULL)` |
| `outside_kernel_authorization` | boolean NOT NULL DEFAULT false | 观察型自己的审计标志：CHECK `(mode = 'observed') = outside_kernel_authorization`——观察型每一行恒为 true，含义“这条链的上线动作**不受内核授权覆盖、也没有任何阻断**”；执行型恒为 false |
| `cost_usd` | numeric(12,4) NOT NULL DEFAULT 0，CHECK ≥ 0 | 本跳 API / 生成成本，不含广告花费。**CHECK `NOT (source_ref ? 'action_run_id') OR cost_usd = 0`**：内核动作的成本只在内核（**更正这类行的 `corrected` 也受此约束**，要改成 > 0 抛 `correction_not_allowed`）。`corrected` 行：入参 `p_cost_usd` **缺省（NULL）= 不替换**，沿用被更正行的成本；显式给了才是替换值（被更正那一行的成本以最新更正为准）|
| `provider_ref` | jsonb | `executed` 必须是**非空对象**（调用方给）。**`observed_live`（以及“更换观察对象”的 `corrected`）由函数从快照行派生，不接受调用方的**（传非空抛 `evidence_invalid`）：`{ad_id, effective_status, snapshot_id, snapshot_captured_at, confirmed_round_at, first_seen_at, target, link_id, link_method, creative_ref, link_strength}`（`first_seen_at` = 该广告最早一行快照的 `captured_at`；`target` = 快照行上的账户 / 系列 / 广告组；`link_*` 与 `creative_ref` 在通过那一刻**冻进来**，之后关联行再被改也不影响这条证据；`link_strength` 如实标 `post_id` 或 `asset_pool_title`，后者较弱，§4 第 4 条）——CHECK 用 `jsonb_typeof` + 键存在 |
| `source_ref` | jsonb | 本跳读到 / 产出的**指针**；`accepted / linked` 带 `downstream`（`{kind, id}` 快照，供重建缓存）；观察型 `approved` 带 `approval`（`{kind:'work_order_review', id, approved_at}`，`approved_at` 抄自批准那一刻的 `review_ref`，`observed_live` 时据此重核）；**`observed_live` 必带 `snapshot_ref`（`{table:'ad_entity_snapshots', id}`，调用方只给这个指针；由人指认的另带 `designated: true`）**；`reconciled` 调用方只给 `window`（`t7 / t14`）与（接续时）`supersedes`，**`result`（`match / mismatch / unmeasurable`）与 `evidence`（用到的日数据行 id + 汇总）由函数算了写进去**；`corrected` 必带 `corrects`（被更正的 `receipt_key`），可选 `case_closed: true`（结案标志，§5.2）或 `replace_observation`（更换观察对象，§6）。CHECK 键存在且取值在清单内 |
| `payload_hash` | text NOT NULL | 函数用规范 `jsonb` 文本算 SHA-256，**不接受调用方传入**；**只哈希调用方给的入参**：阶段、`actor`、`approved_by`、授权来源 + id、调用方的 `provider_ref`、调用方的 `source_ref`、`cost_usd`——不含函数派生的值（`observed_live` 的 `provider_ref`、`reconciled` 的 `result / evidence`：它们依赖读到的数据，重试时可能不同），也不含 `waiting_on / next_due_at / note` |
| `note` | text，≤ 2000 字 | 一句话说人话 |
| `created_at` | timestamptz NOT NULL DEFAULT now() | 函数不接受调用方时间，表又没有写权限，所以不能倒填 |

唯一性 / 索引：`unique(request_id, seq)`；`(client_id, created_at desc)`；部分唯一索引 **`unique(authorization_source, authorization_id) WHERE stage = 'executed'`**、**`... WHERE stage = 'approved' AND authorization_id IS NOT NULL`**（冲突时函数把底层唯一冲突翻成机器可读码 `authorization_already_used`，不让裸 SQLSTATE 23505 漏出去）；**对账链**：`unique(request_id, (source_ref->>'window')) WHERE stage = 'reconciled' AND NOT (source_ref ? 'supersedes')`（每个窗口只有一个“首条”）、`unique(request_id, (source_ref->>'supersedes')) WHERE stage = 'reconciled' AND source_ref ? 'supersedes'`（链不分叉，冲突翻成 `reconcile_chain_conflict`；`supersedes` 只能指向 `result = unmeasurable` 的链头，`match / mismatch` 是终局，§5.2）。**广告认领的唯一索引在请求表上**（`observed_ad_id`，§3.3），冲突翻成 `ad_already_claimed`。

### 3.2 配套对象
- **`ad_agent_event_outbox`**：`receipt_key` PK + FK、`event_name`、`payload`（只带 `{client_id, request_id, receipt_key}`）、`created_at`、`emitted_at`。函数在写回执的**同一事务**里写一行；`emitted_at` 只能经 `ad_agent_mark_event_emitted_v1(receipt_key)` 从空变一次值（触发器管）。
- **`agent_request_heads`**（视图）：`ad_agent_requests` **LEFT JOIN LATERAL** 最新一行回执——没有任何回执的请求也在里面；带 `last_state_change_at`、`hard_deadline_at`（§8）、`mode`、**`closing_stage`**（把请求推进到 `fulfilled` / `fulfilled_observed` 的那条回执的阶段）与 **`status_label`**（展示文案的唯一来源：`fulfilled` → “已完成（内核授权并回读）”，`fulfilled_observed` → “观察到在投（非内核授权）”，**任何地方不得把观察型写成“已上线 / 已履约”**）。`WITH (security_invoker = true)`，`REVOKE ALL … FROM PUBLIC, anon, authenticated`，只给 `service_role` SELECT。
- **没有“规则数据表”**：转移规则、模式、`action_key` 白名单、授权来源白名单都写在函数体里。改规则 = 改迁移 = A 级。

### 3.3 权限与触发器（真正的“唯一写入”）
| 对象 | `service_role` 能做什么 | 其它角色 | 触发器兜底 |
|---|---|---|---|
| `agent_request_receipts` | **只有 SELECT**（撤销 INSERT / UPDATE / DELETE / TRUNCATE）| anon / authenticated / PUBLIC：全撤 | BEFORE INSERT：只放行台账写函数（属主角色 + 会话标志，见下）；BEFORE UPDATE OR DELETE（行级）与 BEFORE TRUNCATE（语句级）一律报错 |
| `ad_agent_event_outbox` | 只有 SELECT | 全撤 | BEFORE INSERT：同上；UPDATE 只允许 `emitted_at` 空→一次值（且只认 `mark_event_emitted_v1` 的会话标志）；DELETE / TRUNCATE 报错 |
| `ad_agent_requests`（119 的表，**本稿迁移追加**）| SELECT；**INSERT 也撤销**（请求创建改走 SECURITY DEFINER 函数 `ad_agent_create_request_v1`，同事务写第一条 `issued` 回执，规格见 §5.5）；撤销 UPDATE / DELETE / TRUNCATE | 全撤 | BEFORE INSERT：只放行 `create_request_v1`（会话标志，见下）；`created_at = now()`（覆盖调用方给的值）、`status = 'requested'`、`downstream_ref` 与 `observed_ad_id` 为空、`valid_until` 必须在 `(created_at, created_at + 30 天]`。BEFORE UPDATE：**不可变列**——`request_id / client_id / request_type / 合同正文 / idempotency_key / created_by / created_at / valid_until`——任何身份、任何路径都不许变（含属主）；**函数派生列**——`status / downstream_ref / observed_ad_id / updated_at`——只放行 `apply_receipt_v1`。另：部分唯一索引 `unique(observed_ad_id) WHERE observed_ad_id IS NOT NULL`；CHECK `status <> 'fulfilled_observed' OR (observed_ad_id IS NOT NULL AND downstream_ref ? 'kind' AND downstream_ref ? 'id' AND downstream_ref->>'terminal_status' IS NOT NULL)` |
| `execution_items.agent_request_id`、`content_work_orders.agent_request_id`（回链列，§6；**第 0 步独立迁移，不挂外键**，§10）| 照旧可写其它列 | — | BEFORE UPDATE：该列**只许从空写成一次**，改值或清空报错 |
| 函数 `ad_agent_apply_receipt_v1` / `ad_agent_mark_event_emitted_v1` / `ad_agent_create_request_v1`，只读的 `ad_agent_ledger_security_check_v1()`（§8 的权限与函数集合核对），以及本稿所有**触发器函数** | `GRANT EXECUTE` 给 `service_role`（触发器函数不授）| `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` | **三个写函数 `SECURITY DEFINER`（核对函数与触发器函数是 `SECURITY INVOKER`），全部 `SET search_path = ''`——触发器函数和辅助函数也钉**，函数体里所有对象全限定 `public.xxx` / `pg_catalog.xxx`（内核函数用的是 `public`；这里收到空串，防“有人在 `public` 建同名函数劫持”）|

- **触发器的身份判断：属主角色 + 会话标志 + 常驻核对，三层缺一不可**（v0.5 只按角色名放行，属主名下任何别的 DEFINER 函数都能绕过——子牙 / 魏征 v0.5 复审指出）：①**属主角色白名单**：运行时从 `pg_proc` 查本函数的 `proowner`，不硬编码名字；黑名单（只拦 API 角色）会漏掉脚本用的直连角色。②**会话标志**：三个台账写函数的**第一句**都是 `set_config('ad_agent.ledger_writer', '<函数名>', true)`（事务内有效）；触发器放行条件 = 属主角色 **且** 标志等于该表该操作允许的函数名——回执表 / 发件箱的 INSERT 只认 `apply_receipt_v1 / create_request_v1`，发件箱 `emitted_at` 只认 `mark_event_emitted_v1`，请求表按上面那一行；属主名下别的函数不设标志就写不进去。③**常驻核对**（§8 第 5 项）：属主名下函数体里引用这几张表的函数集合 = 白名单，且各自 `md5(prosrc)` 与迁移里记录的一致——有人加了函数（哪怕设了标志）也会被发现。触发器函数本身是 SECURITY INVOKER。**仍然防不住的**：能在库里以属主身份建 / 改函数的人（DBA 通道，§11）。
- **常驻权限断言**（只读函数 `ad_agent_ledger_security_check_v1()`，监督函数每小时调一次）：对每张受保护表取 `aclexplode(pg_class.relacl)` ∪ `aclexplode(pg_attribute.attacl)`（**列级授权**）与 `pg_proc.proacl`（EXECUTE），与迁移里写死的“期望授权集合”做**精确集合比对**——期望：回执表 / 发件箱 = 属主全权 + `service_role` 只有 SELECT；请求表 = 属主 + `service_role` 只有 SELECT；三个写函数 = 属主 + `service_role` EXECUTE。**多出任何一项（含 PUBLIC，即 grantee = 0，和任何列级 GRANT）都红**；`has_any_column_privilege(角色, 表, 'INSERT,UPDATE')` 与 `has_table_privilege(角色, 表, 'DELETE,TRUNCATE')` 作第二道（`has_table_privilege` 单独用查不到列级授权）。同时核**触发器函数与写函数的 `proconfig` 里 `search_path` 是空串**；**再核本稿所有触发器都在、且 `pg_trigger.tgenabled = 'O'`（启用）——名单写在迁移里，`ALTER TABLE … DISABLE TRIGGER`、触发器被删、被改成仅复制角色触发（`R`）都红**（119 的 `ad_creative_links` 写一次触发器，§12 第 11 条，也在名单里）。这样“有人 GRANT 回去 / 新迁移默认授权又盖回去 / 列级授权偷开”不会静默。
- **应用运行时不得使用属主身份的直连连接串**：Supabase 的 SQL 编辑器、迁移、MCP 的 `execute_sql` 以属主身份跑，不受上面的权限与触发器约束，这是 DBA 通道，靠流程管（A 级、PM 显式 go）；应用代码只用 `service_role` 的 API 连接。
- RLS：新表**启用 RLS 且不建任何策略**（`service_role` 本来绕 RLS，真正的控制是上面的权限与触发器；v0.3 里“不开 UPDATE/DELETE 策略”与“FOR ALL TO service_role”两句互相矛盾，已删，不再把 RLS 当防线）。

## 4. 模式、授权与对外动作
**模式（函数体里按请求类型定；本期 `creative` = 观察型，其余 = 执行型）**

> **观察型的一句话边界（spec 明写）：创意上线不受内核授权覆盖，也没有任何阻断。台账只观察——所以一条被人手动上线、没经过任何内核授权的广告，只要成片已在 ME 审核页被批准、它的内容绑定对得上、又落在请求合同指定的广告组里，同样会拿到 `fulfilled_observed`。这个终态只表示“观察到在投”，不表示“授权过 / 安全 / 我们投的”，任何地方不得写成“已上线 / 已履约”，更不能当 W2 启用前闸的依据（§11）。**

| | 观察型（本期 `creative`）| 执行型（其余类型，等内核动作落地）|
|---|---|---|
| 收尾阶段 / 终态词 | `observed_live → fulfilled_observed`（展示“观察到在投”）| `executed → completed → fulfilled` |
| `approved` 的含义 | **内容批准**：人在 ME 审核页批准了成片。**只许 `human:<邮箱>`**（`policy:` / `kernel:` 抛 `approver_invalid`）；**必须先有 `approval_requested`**（`pending_pm_approval → executing`，不许 `accepted → executing`）；`source_ref.approval = {kind:'work_order_review', id:<工单 id>, approved_at}`——只记指针当证据，不是授权（`approved_at` 抄自批准那一刻的 `review_ref`，`observed_live` 时据此重核）。函数核验：工单存在 ∧ 客户一致 ∧ 回链列 = 本请求 ∧ 该工单已绑定为本请求的下游 ∧ `status` 在**批准后集合**（`approved / publishing / published / measuring / closed`，§6）内 ∧ **`review_ref` 里的批准记录齐全**：`lower(review_ref.approved_by)` = 该邮箱（对不上抛 `approver_mismatch`）∧ `review_ref.approved_at` 是合法时间且不晚于 now()+5 分钟 ∧ **`review_ref.approval_source = 'me_review_route'`** ∧ **`review_ref.approver_scope = 'global_admin'`**（缺任一项或取值不对抛 `approver_source_invalid`）。**批准之后下游锁死**：`executing` 下不再允许 `linked / delivered`（§5.3），`observed_live` 还要对“批准的那个工单”把这些核验重做一遍（下面第 5 条）| **执行授权**：按下面的授权核验 |
| 批准人从哪来 | 只收 **ME 审核路由里服务端已验证的内部员工会话邮箱**。库里的防线是上面对 `review_ref` 的核验，不是 TS 类型：①**ME 审核路由**在 `applyApprove` 写 `review_ref` 时**必须**带 `approval_source = 'me_review_route'` 和 `approver_scope`——用 `requireGlobalAdmin()`（现有的“内部员工唯一判据”）判，通过写 `'global_admin'`，没通过（限定单个客户的演示管理员也走得到这个路由）写 `'scoped_admin'`；②**Airtable 同步路径**（`review-sync.ts`）显式写自己的 `approval_source = 'airtable_sync'`，**永不写**路由那个值；③所以 Airtable 批的、受限演示管理员批的，函数都过不了 `approver_source_invalid`，请求停在 `pending_pm_approval`，监督函数出待办“该成片不是经 ME 审核页由内部员工批准的，请管理员在 ME 审核页确认”（§12(e)；74 号已定 PM 只在 ME 审核页批准）；④TS 外壳对观察型 `approved` 的批准人入参仍是品牌类型 `VerifiedReviewer`（只能由包住 `requireGlobalAdmin` 的帮手造出），但**那只是编译期的第二层，不是防线**（品牌类型挡不住绕过类型系统的调用，库里也看不到它）。**如实写明（§11）：这两个标记能区分“哪条代码路径写的”，防不住持有 `service_role` 钥匙的人直接改写 `review_ref` 这个 jsonb。**需要一个前置小 PR（§10 ②''）先让路由和同步器写这些标记| 按授权记录里的“人”（下面）|
| 授权字段 | `authorization_*` 必须为空 | `approved` / `executed` 必填 |
| 非法阶段 | `executed`、`completed`（抛 `illegal_transition`）| `observed_live` |
| `observed_live` | **观察到这条广告在投**，证据只认库内**盯盘快照行**：观察者（actor `ad_watch`）只给指针 `snapshot_ref`，**函数回读并派生 `provider_ref`**（下面“观察核验”）。**符合条件的广告只有一条才自动认领**；多于一条时观察者被拒（`observation_ambiguous`），改由**人指认**（actor `human`，`approved_by = human:<邮箱>`，备注必填，函数同样整套核验）。`no_publish` = NULL，`outside_kernel_authorization` = true。下游须是批准的那个成片工单。不声称授权，不声称是我们投出去的 | — |

**观察型 `observed_live` 的核验（全部在函数里做，任何一条不过整笔不写；共八条）**
1. **快照行**：`snapshot_ref = {table:'ad_entity_snapshots', id}`（别的表一律拒）；该行 `level = 'ad'`、`client_id` = 请求客户、`ad_account_id` 是该客户在 `client_meta_ad_accounts` 登记的账户；**`effective_status = 'ACTIVE'`**（“在投类”只此一个，常量写在函数体；其余——PAUSED、ADSET_PAUSED、CAMPAIGN_PAUSED、DISAPPROVED、PENDING_REVIEW 等——抛 `observation_not_live`）；`captured_at` 晚于本请求的 `approved` 回执、不晚于 now()+5 分钟。
2. **“现在还是”**：该行是此广告（同 `client_id + entity_id`）的**最新**一行快照，**且** `ad_snapshot_captures` 里同账户、`level = 'ad'`、`complete = true`、`skipped_shared = false` 的最近一轮在 **12 小时内**（抓取每 6 小时一轮，容忍漏一轮）。广告级行只在变化时才记，所以“没有更新的行 + 近期抓全”才等于“这之后没变”；否则抛 `observation_stale`。
3. **对上请求合同的目标**（v0.7，复审高 3）：`creative` 合同里写**目标** `target = {ad_account_id, campaign_id, adset_id}`（请 119 在合同里给，§12 第 12 条）；快照行上的 `ad_account_id / campaign_id / adset_id` 必须**逐项等于**合同目标，否则抛 `observation_target_mismatch`。合同若还写了日预算上限 `max_daily_budget_cents`，则目标广告组（预算挂在系列上的取系列）**最新一行**快照的 `daily_budget_minor` 不得超过它，超了同样抛 `observation_target_mismatch`。这样别的广告组 / 别的系列里投的同一帖子（包括 1 美元的测试广告）认领不了本请求。
4. **广告 ↔ 成片绑定（内容绑定类）**：`ad_creative_links` 有 (client_id = 请求客户, platform = 'meta', ad_id = 快照 `entity_id`) 的行，且 `link_method` 在**内容绑定类**内——`published_post_id`（建广告那一刻记下的帖子 id 精确命中已发布工单）或 `asset_binding`（广告创意的视频 → 素材池条目 → 条目的 `work_order_ref` → 工单，119 的 PR 2990 §1）；`creative_source = 'content_work_order'`；**`creative_ref` = `approved` 回执里批准的那个工单 id**（不是“当前下游”）；`unresolved` 一律不放行。没有行 / 没解析 / 方法不在这两类 / 指向别的工单 → 抛 `creative_link_missing`。**“广告晚于请求”**：该广告在 `ad_entity_snapshots` 里**最早一行**的 `captured_at` 必须晚于请求的 `created_at`（先于请求就存在的广告不可能是本请求的产物），否则抛 `ad_predates_request`——**不用关联行自己的 `created_at`**，因为回填 / 重写都会改它。通过时把 `link_id / link_method / creative_ref` 与 `link_strength`（`post_id` 或 `asset_pool_title`）冻进 `provider_ref`（§3.1）。这个绑定**不是成片内容哈希**，`asset_binding` 比 `published_post_id` 更弱（多了“标题前缀 + 素材池条目”这层间接，§11）。
5. **下游与批准对得上**（v0.7，复审高 1）：`downstream_ref.id` 必须等于 `approved` 回执 `source_ref.approval.id`，并对**当前**下游工单把批准人核验整套重做一遍：`review_ref.approved_by`（`lower()`）仍等于 `approved` 回执的邮箱、`approval_source / approver_scope` 仍合格、`approved_at` 与回执里抄下的一致；对不上抛 `approval_downstream_mismatch`。（批准之后下游本来就锁死，§5.3 §6；这一条兜的是“库里被直接改写”的漏洞。）
6. **一条广告只能被一个请求认领**：函数把 `ad_id` 写进请求表 `observed_ad_id`（部分唯一索引）；已被别的请求认领抛 `ad_already_claimed`。同一请求本期只认领一条广告。
7. **不含糊**（v0.7，复审高 3）：函数在同一事务里数候选——同一客户、满足第 1–4 条、尚未被别的请求认领的广告。**候选不止一条：`actor = ad_watch` 的认领被拒，抛 `observation_ambiguous`**；`actor = human` 的指认只能指其中通过核验的一条。所以“同一成片在同一广告组里被投了两次”不会被谁抢先认领，而是出待办让人定（§8）。
8. **派生**：`provider_ref` 由函数写（§3.1）；调用方传了非空的 `p_provider_ref` 抛 `evidence_invalid`。

**执行型的授权来源（函数体里的白名单）——本稿只放行 `authorization_decisions`（内核）**。其它来源一律拒绝；创意上线的内核动作（暂名 `ads.attach_creative`，A 级）另开卡由 119 评估，落地后创意类请求才切到执行型（改一次迁移）。
- **`authorization_decisions` 的核验**（`approved` 与 `executed` 都做）：行存在 ∧ `client_id` = 请求的客户 ∧ `verdict = 'allow'` ∧ **决策所属的 `action_run` 满足 `triggered_by = 'agent'` 且 `triggered_by_ref = request_id::text`** ∧ **该决策的 `action_key` 在“该请求类型的白名单”内**（白名单写在函数体里，具体键名由 119 在合同里给；内核有 `action_key_mismatch` 校验，台账不能比内核更宽）；`approved` 阶段另要求决策**未过 `expires_at` 或已被兑换**；`executed` 阶段另要求 **`consumed_at` 非空** ∧ **run 的状态是 `running` 或 `succeeded`**。
- **`executed` ≠ 成功**：`consumed_at` 是 run 被领走时就写的，所以 `executed` 只证明“动作开始了”；**成功只认 `completed` 的库内回读**（`action_runs.status = 'succeeded'`，§6）。展示上 `executed` 一行写“已开始”，不写“已成功”。
- **不要求 `executed` 的授权与 `approved` 的是同一份**（`dead_letter` 恢复 / 接管会重签决策）；改成“两跳的决策都属于本请求的 run”。一次性由 `executed` 上的部分唯一索引保证。
- **`approved_by` 与授权记录里的“人”必须对得上**：`human:<邮箱>` 要求决策 `decided_by = 'human'` 且 `lower(decided_by_user)` = 该邮箱；`policy:` / `kernel:` 要求 `decided_by = 'policy'`。
- 先批准后上线、先上线后完成由转移规则保证。`human:` 的批准必须先有 `approval_requested`（走 `pending_pm_approval`）；**仅执行型**的 `policy:` / `kernel:` 可从 `accepted` 直接到 `executing`，观察型没有这条捷径。

## 5. 唯一写入函数 `ad_agent_apply_receipt_v1`
### 5.1 签名与返回
`ad_agent_apply_receipt_v1(p_request_id uuid, p_stage text, p_occurrence text, p_expected_old_status text, p_actor text, p_waiting_on text, p_next_due_at timestamptz, p_approved_by text, p_authorization_source text, p_authorization_id uuid, p_cost_usd numeric DEFAULT NULL, p_provider_ref jsonb DEFAULT NULL, p_source_ref jsonb DEFAULT NULL, p_downstream_ref jsonb DEFAULT NULL, p_note text DEFAULT NULL) returns jsonb`（`p_cost_usd` 缺省 NULL：非 `corrected` 阶段按 0 记，`corrected` 阶段 = 不替换）
返回 `{ outcome: 'inserted' | 'replayed', seq, status_before, status_after, receipt_key }`；失败抛带**机器可读码**的异常：`illegal_transition`、`stale_expected_status`、`receipt_key_conflict`、`actor_not_allowed`、`authorization_invalid`、`authorization_already_used`、`approver_invalid`、`approver_mismatch`、`approver_source_invalid`、`downstream_invalid`、`readback_failed`、`observation_not_live`、`observation_stale`、`creative_link_missing`、`ad_predates_request`、`observation_target_mismatch`、`observation_ambiguous`、`approval_downstream_mismatch`、`ad_already_claimed`、`evidence_invalid`、`reconcile_not_due`、`reconcile_not_enabled`、`reconcile_chain_conflict`、`reconcile_chain_limit`、`request_expired`、`missing_next_due`、`correction_not_allowed`、`request_not_found`。**所有底层唯一冲突（SQLSTATE 23505）都在函数里翻成上面对应的码**，不让裸错误漏给调用方。
**没有 `p_status`、没有 `p_client_id`、没有 `p_seq`、没有调用方时间**：新状态由函数算，客户从请求行读，序号函数自己取，`created_at` 是库的 `now()`。

### 5.2 一个事务里依次做（锁后幂等）
1. 校验参数形状（阶段在清单内、`p_occurrence` 符合格式、`p_actor` 在清单内）。**再按本节末的“阶段 → 允许的 actor”表核 `p_actor` 是否被允许写这个阶段**（不允许抛 `actor_not_allowed`）。拼出 `receipt_key`，算出 `payload_hash`。
2. **锁请求行**（`SELECT … FOR UPDATE`）；不存在抛 `request_not_found`。读出请求类型，定**模式**。
3. **权威幂等检查（锁后）**：按 `receipt_key` 查已有回执。有 → 比 `payload_hash`：相同返回 `replayed`；不同抛 `receipt_key_conflict`。因为已经持锁，原调用若还没提交，重试会在第 2 步排队，等它提交后才走到这里，必然命中 `replayed`；INSERT 仍兜住唯一冲突。
4. 比 `p_expected_old_status` 与当前状态，不同抛 `stale_expected_status`。
5. **转移规则**（函数体里的 `VALUES` 表，按（模式, 当前状态, 阶段），见 §5.3）：没有这一行抛 `illegal_transition`。终态（`fulfilled / fulfilled_observed / rejected / expired / failed`）：`fulfilled*` 只留 `reconciled`、`corrected`，其余终态只留 `corrected`。附加守卫：
   - `approved`：请求未过 `valid_until`（否则抛 `request_expired`）；`accepted → executing` 只许**执行型**且 `approved_by` 是 `policy:` / `kernel:`，**观察型没有这条捷径**（必须经 `pending_pm_approval`）；
   - `expired`：**必须真过了 `valid_until`**；且该请求**没有 `executed` / `observed_live` 回执**、**没有已被兑换的授权决策**——否则拒绝；
   - `executed` / `completed` / `observed_live` / `failed`：**不因时间拒绝**（真实发生的事必须能记下来）；
   - `completed`（执行型）：必须已有 `executed` 回执；`launch` 类型本期不允许进入 `fulfilled`（§6）。
6. **阶段专属校验**（SQL 里做，不信调用方）：
   - `approved`：执行型按 §4 核验授权；观察型按 §4 表核验批准人（`human:`、先有 `approval_requested`、`review_ref` 对账，含 `approval_source / approver_scope` 标记）与工单指针；
   - `executed`：`no_publish = false`、`provider_ref` 非空对象、授权按 §4 核验（含 `action_key` 白名单、run 状态 running / succeeded）；
   - `observed_live`：观察型；按 §4“观察核验”八条逐条做（合同目标、内容绑定类关联、下游与批准对得上、不含糊都在内）；`authorization_*` 为空；`actor = ad_watch` 时 `approved_by` 必须为空，`actor = human`（指认）时必填 `human:<邮箱>` 且备注必填；下游已绑定为 `work_order` 并核验（§6）；`p_provider_ref` 必须为空（由函数派生）；
   - `accepted` / `linked`：可带 `p_downstream_ref {kind, id}`，按 §6 核验后**同事务写入 `ad_agent_requests.downstream_ref`**（执行型：`executed` 之后不允许再改；**观察型：`approved` 之后不允许再绑，状态机上 `executing` 里没有 `linked`，§5.3**）；
   - `completed`：下游必须已绑定，库内回读（§6）；**回读失败整笔回滚**；
   - `reconciled`（对账）：①请求须在 `fulfilled` / `fulfilled_observed`；②**`actor` 只许 `reconciler`**；③`source_ref.window` ∈ `t7 / t14`（天数写在函数体：7 / 14），**窗口未到期拒写**（`reconcile_not_due`）——到期 = `now() ≥ 收尾回执的 created_at + 窗口天数`（收尾回执 = 把请求推进到 `fulfilled*` 的那条，或后来“更换观察对象”的 `corrected`；用库时间，调用方改不了），所以“刚收尾就抢先写一条 match 占位”不成立；④**`result` 与 `evidence` 由函数按证据行算，调用方不能给**：观察型（`creative`）的口径写在函数体——**窗口按广告账户的时区算**：窗口 = 收尾回执当天起的 N 个日历日，时区取该广告账户的账户级快照行（`ad_entity_snapshots`，`level = 'account'`）里最新一行的 `timezone_name`；**读不到时区 → `unmeasurable`，不猜、不退回 UTC**（ME 没有客户级时区配置，日数据的 `insight_date` 本来就按账户时区切，用别的时区会错位）。取 `ad_daily_insights` 里该广告（`level = 'ad'`，`entity_id` = `observed_ad_id`）在窗口内的行：**该客户 ad 级日数据已拉到窗口末**（该客户 ad 级行的最新 `insight_date` ≥ 窗口末那一天；没花钱的广告当天可能没有行，所以看客户整体的拉取进度，不看单条广告）时，**`match` 要求“窗口末仍在投”**——窗口**最后 2 个日历日**里这条广告至少有一天花费 > 0，**且**广告级快照里 `captured_at` 不晚于窗口末、离窗口末最近的那一行 `effective_status = 'ACTIVE'`；任何一项不满足 → `mismatch`（第一天花了 5 美元、第二天被停，窗口末没有花费，是 `mismatch`，不是 `match`）；没拉到窗口末（或该广告在窗口末之前没有任何快照行）→ `unmeasurable`；`evidence` = 用到的日数据行 id（最多 20 个）+ 汇总（窗口起止日与时区、最后 2 天各自的花费、窗口末前最近一行快照的 id / 状态 / 时间、客户 ad 级最新 `insight_date`）。**其它请求类型的对账口径在启用该类型时补进函数体，补之前对它们的 `reconciled` 一律抛 `reconcile_not_enabled`**；⑤**对账是链，不是唯一占位，但只有 `unmeasurable` 能被接续**：每个窗口的第一条不带 `supersedes`；之后的每一条必须 `supersedes` = 该窗口当前链头的 `receipt_key`，**且链头的 `result` 必须是 `unmeasurable`**（`match / mismatch` 是终局，要接续抛 `reconcile_chain_conflict`——已得出的结论不会被后来的回执悄悄翻盘；错了只能由人 `corrected` 结案或新开请求）；同样走上面全部校验、重新算（数据晚到时 `unmeasurable` 可以接续成 `match` 或 `mismatch`；链不分叉，唯一索引兜底）。**接续的节奏也由函数管，不靠监督函数自觉**：距上一条**不足 24 小时**抛 `reconcile_not_due`，同一窗口**接续超过 5 次**抛 `reconcile_chain_limit`；⑥`result` 是 `mismatch` 或 `unmeasurable` 时回执照写，**监督函数据此出“对账不一致”的人工待办**（§8），直到链头变成 `match`（只有 `unmeasurable` 能变），或有人写 `corrected`（`case_closed: true`，人批，备注必填）结案；
   - `corrected`（更正）：**只能更正两类东西，外加两个受控的专用动作**——①`note`；②`cost_usd`（显式给才替换；带 `action_run_id` 的行不能改成 > 0）；以及——③**结案**：`source_ref.case_closed = true`，目标必须是某窗口当前链头且 `result` 是 `mismatch` 或 `unmeasurable`，备注必填；④**更换观察对象**（`source_ref.replace_observation = {snapshot_ref}`，§6；此时 `provider_ref` 由函数从新快照派生，调用方仍不能给；整套观察核验重做）。**v0.7 起删掉了 v0.6 的第③类“更正 `source_ref` 里的指针”**：它能事后改写 `approved / observed_live` 的证据指针（批准的工单、快照、下游快照）而不重核；现在这些指针一律不可更正，认错了只走“更换观察对象”这条整套重核的路。**授权、`no_publish`、阶段、各回执的 `provider_ref`（更换观察对象除外）、`reconciled` 的 `result / evidence` 都不可更正**（要换对账结论，只能由对账者写一条接续的 `reconciled`，且只有 `unmeasurable` 能被接续）；必须 `actor = human` 且 `approved_by = human:<邮箱>`；必带 `corrects`（同一请求下已存在的**非 `corrected`** 回执的 `receipt_key`）与 `note`；违反抛 `correction_not_allowed`。原行保留，展示与总成本以更正为准；
   - 非终态结果必须有 `waiting_on` 与 `next_due_at`（`completed / observed_live` 例外：带对账到期，§8）；`next_due_at` 超过 `hard_deadline_at` 时**截断**，不拒写。
7. `seq = 该请求当前最大 + 1`，写回执（含 `status_before / status_after`）。
8. 更新请求行：`status = status_after`、`updated_at = now()`（必要时 `downstream_ref`；`observed_live` 与“更换观察对象”时 `observed_ad_id`）。底层唯一冲突在这里捕获，翻成 §5.1 的码。
9. 写发件箱一行（同事务）。
10. 返回。

**阶段 → 允许的 `actor`（写死在函数体里；不允许抛 `actor_not_allowed`）**
| 阶段 | 允许的 `actor` |
|---|---|
| `issued` | `ad_agent`（只经 `ad_agent_create_request_v1`）|
| `accepted / linked / delivered / approval_requested` | `ad_agent / video_agent / website_agent / seo_agent`（按请求类型的生产者）|
| `approved` | 观察型：`human`；执行型：`human`，或 `ad_agent / kernel_sync`（`policy: / kernel:`）|
| `rejected` | `human / ad_agent / video_agent / website_agent / seo_agent` |
| `executed / completed` | `kernel_sync / ad_agent`（执行型）|
| `observed_live` | `ad_watch`（观察者，候选只有一条时）；`human`（指认：符合条件的广告多于一条时）|
| `reconciled` | `reconciler`（对账者）|
| `failed` | 各生产者、`kernel_sync`、`system` |
| `expired` | `system` |
| `corrected` | `human` |

`actor` 只是标签，不是凭据：这张表防的是代码接线出错，并让审计一眼读得懂“谁写的”，防不住持钥者冒名（§11）。

TS 外壳 `appendAgentRequestReceipt()`（`src/lib/agent-requests/ledger.ts`）只做三件事：整理参数调 RPC；用 `failClosedIfRpcMissing` 在函数缺失时**当场停**；调用成功后按发件箱发事件并调 `ad_agent_mark_event_emitted_v1`。**回读与核验都不在 TS 里做**。观察型 `approved` 的批准人入参是品牌类型 `VerifiedReviewer`（§4；**编译期的辅助层，不是防线**——库里的防线是函数对 `review_ref` 来源标记的核验），外壳不收字符串。

### 5.3 转移规则（写在函数体里；阶段清单与映射以 119 合同为准，单测展开成矩阵对照）
下表“同状态”= 不改状态。观察型 / 执行型的差别：`accepted` 行的 `approved`、`executing` 行的收尾阶段与 `linked / delivered`、以及 `fulfilled*` 的终态词。
| 当前状态 \ 阶段 | 之后的状态 |
|---|---|
| `requested` | `issued`→requested（仅第一条回执）；`accepted`→accepted；`rejected`；`failed`；`expired` |
| `accepted` | `linked`、`delivered`→同状态；`approval_requested`→pending_pm_approval；`approved`→executing（**仅执行型**且 policy / kernel 批准；观察型没有这一行）；`rejected`；`failed`；`expired` |
| `pending_pm_approval` | `linked`、`delivered`→同状态；`approved`→executing；`rejected`；`failed`；`expired` |
| `executing` | `failed`；`expired`（仅在满足 §5.2 第 5 步的守卫时）。**观察型**：`observed_live`→**fulfilled_observed**；**`linked` / `delivered` 一律 `illegal_transition`**——批准之后下游锁死，要换片 = 新开请求（v0.7，复审高 1）。**执行型**：`linked`（仅在还没有 `executed` 时）、`delivered`→同状态；`executed`→executing；`completed`→fulfilled（须已有 `executed`）|
| `fulfilled` | `reconciled`→fulfilled（窗口到期后，对账链，§5.2）；`corrected`→fulfilled |
| `fulfilled_observed` | `reconciled`→fulfilled_observed（同上）；`corrected`→fulfilled_observed（含“更换观察对象”，仅在还没有任何 `reconciled` 时，§6）|
| `rejected / expired / failed` | 仅 `corrected`→同状态 |

另：**`corrected` 在任何状态下都合法**（不改状态；字段与批准人的限制见 §5.2）。

### 5.4 静态扫描降为辅助
仍保留“只有 `ledger.ts` 调这个 RPC”的全仓扫描，但**它不再是防线**：库里没有写权限，直接被拒（属主身份 SQL 除外，§3.3）。

### 5.5 `ad_agent_create_request_v1`（请求创建；v0.6 补规格，归 122 写，与 119 对接）
`ad_agent_create_request_v1(p_client_id uuid, p_request_type text, p_contract jsonb, p_idempotency_key text, p_valid_until timestamptz, p_created_by text) returns jsonb`
返回 `{ outcome: 'created' | 'replayed', request_id, receipt_key }`；失败抛带机器可读码：`request_type_invalid`、`contract_invalid`、`idempotency_conflict`、`valid_until_invalid`、`client_not_found`、`actor_not_allowed`。**没有 `p_request_id`、没有 `p_status`、没有调用方时间**——请求号 `gen_random_uuid()`、`created_at = now()`、`status = 'requested'` 都是函数自己写的。
函数体，一个事务里依次做：
1. 形状：`p_request_type` 在封闭清单内（`budget / audience / creative / page / seo / launch`）；`p_created_by` 在 actor 清单内，且按 §5.2 末的表允许写 `issued`（即 `ad_agent`）；`p_idempotency_key` 符合 `^[A-Za-z0-9._:-]{8,200}$`；`p_valid_until` 在 `(now(), now() + 30 天]`。
2. 客户存在（`clients`）。
3. **按 `p_request_type` 校验合同正文 schema**：每个类型的必填键 / 类型 / 取值范围 / **不允许多余的键**写在函数体里（键名与取值由 119 的合同目录给，函数体抄写，单测把函数的校验规则与合同 schema 常量逐类型对照，漂了就红）。不过抛 `contract_invalid`。
4. 锁 `(client_id, idempotency_key)`（对唯一索引做 `INSERT … ON CONFLICT`，或 `pg_advisory_xact_lock`），查已有请求：有 → 比规范化合同的 SHA-256：相同返回 `replayed`（连同已有的 `request_id`），不同抛 `idempotency_conflict`。
5. 写请求行；**同一事务**内走与 `apply_receipt_v1` 同一个内部写入例程写第一条 `issued` 回执（`seq = 1`，`status_before = status_after = requested`）和发件箱一行。
6. 返回。
请求表触发器的不可变列（§3.3）、`unique(client_id, idempotency_key)`（要 119 给，§12）与第 4 步互相兜底。

## 6. 下游绑定、`fulfilled` 的回读（库内）
`ad_agent_requests.downstream_ref = {kind, id, terminal_status}`：
- **绑定**：`kind / id` 在 `accepted` 或 `linked` 回执里由函数写并核验；**执行型**在 `executed` 之前可以重绑（执行卡被批量删、绑错了），每次绑定都是一行回执，`executed` 之后锁死；**观察型在 `approved` 之前可以重绑（绑错了、换了新工单），`approved` 之后锁死——`executing` 状态下没有 `linked / delivered`（§5.3），要换片 = 新开请求**（v0.7：v0.6 在 `executing` 下还允许 `linked`，批准的是工单 A、观察时下游已被换成工单 B，复审高 1）。**没绑定就 `completed` / `observed_live` 不了**（fail closed）。**观察型只许绑定 `kind = 'work_order'`，执行型只许 `action_run` / `execution_item`。`observed_live` 之后绑定锁死；认错广告的更正办法见下“更换观察对象”。**
- **绑定时的核验**：对象存在 ∧ 客户一致 ∧ 回链列等于本请求（`action_run` 看 `triggered_by_ref`）∧ **对象创建晚于请求** ∧ **绑定那一刻对象还不在成功终态**。`created_at` 之所以可信，是因为请求表的 `created_at` 由触发器强制为 `now()`（§3.3）。
- **工单状态的两个集合（v0.7 写明；此前 §4 与 §6 的说法对不上）**：**批准后集合** = `approved / publishing / published / measuring / closed`——观察型 `approved` 与 `observed_live` 核验“成片已被批准”用它；**成功终态** = `published / measuring / closed`——绑定那一刻对象已在成功终态 = 旧对象，不许绑。两个集合不同：批准后集合多了 `approved / publishing`（批准了、还没发出去），成功终态不含它们。
- **回链列只许从空写成一次**（触发器）——旧对象不能被改绑到新请求；错绑的对象就废在那儿，请求侧重绑另一个。
- **`terminal_status` 只在 `completed`（执行型）或 `observed_live`（观察型）时由函数回读后写**，不接受调用方提供。

**执行型 `completed` 的回读**（按 `kind`；**只允许 `action_run` 与 `execution_item` 两类下游**——工单表没有和 run 对应的字段，无法把授权绑到工单）：
| kind | 回读条件（全部满足才放行）|
|---|---|
| `action_run` | `action_runs.status = 'succeeded'` ∧ `client_id` = 请求客户 ∧ `triggered_by = 'agent'` ∧ `triggered_by_ref = request_id::text` ∧ `created_at ≥ 请求.created_at` ∧ **该 run 就是 `executed` 回执里授权决策所属的 run**（授权与下游动作绑在一起，子牙1）|
| `execution_item` | `status = 'completed'` ∧ `client_id` 一致 ∧ `agent_request_id` = request_id ∧ 创建晚于请求 ∧ **`executed` 授权所属 run 的 `execution_item_id` 等于该执行项** ∧ **该 run 的 `status = 'succeeded'`**（v0.6 补：此前只核了执行项自己的状态，而它是人可以点“完成”的；子牙 / 魏征 v0.5 复审中项 4）|
| 其它（含 `work_order`）| **拒绝**（fail closed）；新增 kind = 改迁移 |

**观察型 `observed_live` 的下游核验**：下游 `kind` 只许 `work_order`（成片工单；执行项接不上 `ad_creative_links`）；对象存在 ∧ 客户一致 ∧ 回链列 = 本请求 ∧ 创建晚于请求 ∧ `status` 在**批准后集合**内 ∧ **`id` = `approved` 回执批准的那个工单**（§4 第 5 条）。这只证明成片在流程里走到了批准；**“这条广告投的就是这条成片”由 §4“观察核验”第 4 条（`ad_creative_links`）负责，“广告现在在投”由第 1、2 条（快照）负责，“广告落在请求指定的广告组”由第 3 条负责。**
- **更换观察对象（认错 / 写错广告的更正路径，v0.6）**：`observed_live` 之后绑定锁死，`observed_ad_id` 也不能随便改。认错了广告，由人写一条 `corrected`（`actor = human`，`approved_by = human:<邮箱>`，备注必填），`source_ref = {corrects: <observed_live 的 receipt_key>, replace_observation: {snapshot_ref}}`：函数对**新的快照指针**把 §4“观察核验”八条整套重做一遍（含合同目标与“不含糊”），通过后**同一事务**里把请求表 `observed_ad_id` 改成新广告（旧广告的认领随之释放，唯一索引重新判），新旧两行回执都保留；对账的到期基准改用这条更正回执的时间。**一旦已有任何 `reconciled`，不允许更换**（对账是对着旧广告做的；要换请新开请求）。

- `fulfilled` 的 CHECK（119 的表上）：`status <> 'fulfilled' OR (downstream_ref ? 'kind' AND downstream_ref ? 'id' AND downstream_ref->>'terminal_status' IS NOT NULL)`；`fulfilled_observed` 另有 §3.3 的 CHECK（要求 `observed_ad_id` 非空）。119 §8 的更强版（`terminal_status` 属于按 kind 约定的成功集合）兼容，建议用它（§12）。
- **`launch`**：本期不写、也不允许 `fulfilled`；W2 再定 `cron_run_log` 这个 kind 的库内核验。

## 7. `receipt_key`、重试与事件
- **出现编号由生产者给，是业务编号，不是重试次数**：`delivered` 用草稿版本号（如 `draft-2`）；`executed` 用授权 id 的后缀；`linked` 用被绑对象 id 的后缀；`observed_live` 用观察到的（或被人指认的）广告 id 的后缀；`reconciled` 用窗口名（`t7`），接续的用窗口名加链位（`t7-r2`、`t7-r3`）；其它一次性阶段用 `1`。重试 / 重放用同一个编号，所以幂等；合法的第二次 `delivered`（两版草稿）编号不同，所以不会被吞。
- 同键同载荷 → `replayed`（成本不会重复累计）；同键异载荷 → `receipt_key_conflict`；**错写了怎么办 → `corrected` 更正回执**（受限，§5.2），不改原行。
- **成本口径**：同一动作的成本只记一处（§1 规则⑥）。内核同步器写的行 `cost_usd = 0`（CHECK 强制），台账总成本视图 = 台账行（按“被更正者以更正为准”）之和，**内核成本单列展示、不与它相加**。
- **发件箱**：回执与待发事件在同一事务落库；TS 外壳随后发事件（事件 id = `receipt_key`）并标记已发；崩在中间，监督函数把 `emitted_at` 为空超过 10 分钟的补发。**发件箱不是安全边界**，且 Inngest 按事件 id 去重只有约 24 小时——**所有消费者必须按 `receipt_key` 幂等**。
- 119 的 `idempotency_key` 含“周期日”：周期日取 NZ 日期（写进合同）；`failed / rejected / expired` 之后同周期要能重发——建议带 `supersedes_request_id` 或把重发次数并进键（§12）。

## 8. 监督函数 `ad-agent-request-watch`（每小时，新西兰 :35；`ad_agent.request_watch.requested` 可人手叫醒）
读 `agent_request_heads`，判七类，**并承担两个会写回执的步骤——观察者、对账者**（运行回执写 `cron_run_logs`；读不到请求表 = 函数自己失败，如实写 failed）：
1. **卡住**（非终态）：`next_due_at < now()`，**或** `now() > hard_deadline_at`。`hard_deadline_at = 请求.created_at + 该请求类型的最长全程`——**默认（74 号定）：budget 48 小时 / audience 7 天 / creative 14 天 / page 14 天 / seo 30 天 / launch 空**；可按请求覆盖但不得超过 30 天；函数写 `next_due_at` 时超过它就**截断**（不拒写），所以反复追加“草稿已出”之类的回执推迟不了“卡住”。**没有任何回执的请求**：发出后 2 小时仍无 `accepted` → 卡住。
2. **过期**：非终态且真过了 `valid_until`——没有 `executed` / `observed_live` 回执、也没有已兑换授权 → 经函数追加 `expired`；**已有 `executed` / `observed_live` 或授权已被兑换** → 不得转 `expired`（函数拒绝），改推红待办“已上线（或已兑换）但已过有效期，请人决定是否停”。
3. **已完成但缺对账**：`fulfilled` / `fulfilled_observed` 且对账到期（T+7）已过、没有对应窗口的 `reconciled` → 先由下面的**对账者步骤**补写；日数据没拉到时对账者也会得到一条 `unmeasurable` 回执，所以这一类待办只剩“对账者自己没跑”的情形。
4. **对账不一致**：某窗口当前链头的 `result` 是 `mismatch` 或 `unmeasurable`、且还没结案 → **需人工的待办**（`match / mismatch` 是终局；`unmeasurable` 接续满 5 次仍没结论也停在这里）（what：哪条请求、比对出什么不一致；how：谁去核；href：链路页）。人处理后写 `corrected`（`case_closed: true`，人批、备注必填）**结案**，或等对账者接续写出 `match`；**没结案每天推一条，结案后消失**——不静默，也不永远挂着。
5. **权限与属主名下函数核对**：调 `ad_agent_ledger_security_check_v1()`（§3.3）——授权集合与期望不一致（含 PUBLIC、列级授权）、`search_path` 没钉、属主名下引用台账表的函数集合 / 函数体哈希变了、**本稿触发器被禁用 / 被删 / 被改成仅复制角色触发（`tgenabled ≠ 'O'`）** → 红待办（“台账的写保护被人改了”）。
6. **发件箱漏发**：补发（§7）。
7. **多条候选待指认**：观察者发现同一请求有多于一条广告满足 §4 观察核验（`observation_ambiguous`）→ **需人工的待办**（what：哪条请求、哪几条广告（广告号 + 在投状态 + 最早快照时间）；how：核对后在链路页点“指认”，由人写 `observed_live`（`actor = human`，`approved_by = human:<邮箱>`，备注必填），函数同样整套核验；href：链路页）。没指认的每天推一条，指认后消失。
- **观察者步骤（actor `ad_watch`）**：对每个观察型、`executing`、已有 `approved` 回执的请求：取 `ad_creative_links` 里 `creative_ref` = **`approved` 回执批准的工单 id**、已解析（内容绑定类）的广告，逐条看是否满足 §4“观察核验”八条（含合同目标）；**候选恰好一条且通过 → 调 `apply_receipt_v1` 写 `observed_live`**（`p_occurrence` = 广告号后缀，`p_source_ref = {snapshot_ref}`）；**多于一条通过 → 什么都不写，出“指认”待办（第 7 类）**；没有一条通过 = 什么都不写，请求继续等（卡住 / 过期照常判）。**观察者不评价广告好不好，只记“看到在投”；它也不替函数做“第一条通过的就认领”的选择**（v0.6 是按 `created_at` 升序取第一条，1 美元的测试广告能抢先认领——复审高 3）。
- **对账者步骤（actor `reconciler`）**：对每个 `fulfilled_observed` 且某窗口已到期的请求：该窗口还没有链头 → 写第一条 `reconciled`（`p_occurrence` = 窗口名，`p_source_ref = {window}`）；链头是 `unmeasurable` → 尝试接续（`supersedes` = 链头）。**接续的间隔（距上一条 ≥ 24 小时）与次数（≤ 5）由函数把关（§5.2），这里只是按时叫它**，被拒（`reconcile_not_due` / `reconcile_chain_limit`）就等下一小时，或转人工待办。**结论由函数算（§5.2），对账者只负责按时叫它。**
- 待办写法：what / how / href 三件套；同一请求同一状态一天一条。默认时限（写入者填 `next_due_at` 时用）：预算类批准后 2 小时 / 受众类 24 小时 / 素材类 72 小时出草稿、批准后 24 小时观察到上线 / 页面类 48 小时 / SEO 类 7 天，**都受 `hard_deadline_at` 约束**。
- **`actor` 不是凭据**：任何依赖链上回执的闸**只认库内核验通过的结果**（执行型：`completed` + 下游回读 = `fulfilled`；观察型：`fulfilled_observed` 只是观察线索，**永远不能**当“启用前闸”的依据，见 §11），不认 `actor` 文本。
- 新 Inngest 函数合并后要有人对 `/api/inngest` 重新 Sync；新增函数要登记 cron 登记表（机器判 A）。

## 9. W1 验收与测试
**W1 验收（唯一一条端到端链）**：诊断 → creative 请求（`issued`）→ 视频 Agent 接单（`accepted`，绑定成片工单）→ 出片并过质检（`delivered`，带成本）→ 送审（`approval_requested`）→ PM 在 ME 审核页批准（`approved`，记指针当证据）→ 观察者看到广告在投（`observed_live`）→ T+7 对账（`reconciled`，结论由函数按日数据算）。每一跳有回执（含成本、批准人、`mode`、`outside_kernel_authorization`、观察证据、下一步谁 / 最晚何时），链路页能画出来。没真实跑通不叫做好，单测绿不能代替。**创意上线的内核动作落地前，不验收 `executed / completed` 这条路。验收拆成 W1a（`issued … approved`，不依赖关联表和快照，先验）与 W1b（`observed_live … reconciled`，卡在 119 的 PR 2990，另开台账卡），见下。**
**验收拆成 W1a / W1b 两段，再加一张 T+7 的台账卡，不拿 T+7 当场验（v0.7，复审中 7）**：
1. **W1a（`issued → accepted → delivered → approval_requested → approved`；不依赖 `ad_creative_links`，也不依赖盯盘快照，先验）**：
   - **一次性测试库（合并前必做）**：按真实表结构造的**合成夹具**（虚构数据，不是生产数据的拷贝——生产里没有可解析的关联行，§2）：工单行与 `review_ref`（含 `approval_source / approver_scope`），经真函数把链路从 `issued` 跑到 `approved`；同时跑本节全部与批准有关的“被拒”用例。
   - **生产首条真实链路（随 apply 取得 PM 显式 go；写生产库）**：apply 之后，走一条**新的**创意请求从 `issued` 跑到 `approved`（只写台账行，没有外部动作）；批准必须真在 ME 审核页做（74 号已定：PM 只在审核页批）。**前提是 §10 ②''（审核路由写来源标记）已合并**，否则 `approved` 会被 `approver_source_invalid` 拒。
2. **W1b（`observed_live → … → reconciled`；卡在 119 的 PR 2990，另开台账卡）**：
   - **合成夹具**（按真实表结构造的虚构数据：工单行与 `review_ref`、`ad_creative_links` 行（含 `asset_binding`）、广告级与账户级快照行与抓取记录、日数据行）；**把时间排成“请求在前、广告在后”**——已存在的广告 / 工单 / 执行项不能事后绑到新请求，这是防抢认领的核验，不为验收放宽；沙盘里以属主身份可以改时间。经真函数跑到 `observed_live`；`reconciled` 在沙盘里同样以属主身份把收尾回执的 `created_at` 往前拨 7 天，走一次到期对账（生产里拨不动，这只是验证函数路径）。夹具要覆盖：目标广告组内唯一候选 / 两条候选（`observation_ambiguous`，之后由人指认）/ 别的广告组的候选（`observation_target_mismatch`）/ 窗口末被停（`mismatch`）。
   - **生产首条真实链路**：要等 §10 ②'（创意类广告建广告处 / 登记入口写出可解析的关联行，owner 119）落地——今天库里没有一条可解析的关联（§2），所以这一段现在会“没过”。**如实报“W1b 没过”，不凑、不放宽函数的核验。**开台账卡 `2026-10-21-agent-ledger-w1b-first-real-observation`（`verify_by` 先定 2026-11-04，②' 没落地就顺延并写原因）。存量广告（如 10-20 开投的那批）不在这一段，回填另设计（§12(g)；74 号已定：A 级、PM 显式 go）。
3. **首次真实对账只能在 T+7 之后发生**，不属于当场验收：开台账卡，`verify_by` = 首条真实 `observed_live` 回执日期 + 7 天（台账闭环巡检会读它），到期核三件事——`reconciled` 回执在；`result` 与肉眼核对的日数据一致；`mismatch / unmeasurable` 有待办。

**实现自带的测试（合并前必须绿；库内规则必须有真 PostgreSQL 测试，照 `optout.integration.pg.test.ts` 的写法）**：
- **测试库先按 Supabase 的默认授权给 `service_role / authenticated / anon` 建好角色和权限**（沙盘里 `service_role` 是空角色，不先授权，“被拒”恒真），再 `SET ROLE` 逐个试写；另用**属主身份的脚本连接**试 UPDATE 请求表的 `status`：必须被触发器拒（会话标志），只有经函数路径才成功；**属主名下另建一个 DEFINER 函数直接 UPDATE 请求表 / INSERT 回执表（不设会话标志）→ 必须被触发器拒**；**对本稿某个触发器执行 `ALTER TABLE … DISABLE TRIGGER`（属主身份）→ 常驻核对函数 `ad_agent_ledger_security_check_v1()` 报红**。
- **`search_path` 劫持**：在 `public` 里建同名函数 / 同名表 / 同名操作符，调用写函数（和触发器函数）的结果不变。
- 转移矩阵：把函数对每个（模式, 状态, 阶段）的输出展开（**九态**），与合同常量逐格对；观察型下 `executed / completed` 被拒、执行型下 `observed_live` 被拒；观察型 `accepted → approved` 被拒；**观察型 `executing` 下 `linked / delivered` 被拒（批准后下游锁死）**；终态后再 `approved`、倒退、没有 `executed` 就 `completed` → 都被拒。
- `actor` 矩阵：每个阶段用不被允许的 `actor` 写 → `actor_not_allowed`；`kernel_sync` 的行没有 `action_run_id` → CHECK 拒。
- 授权（执行型）：缺授权 / 别的客户 / 决策所属 run 的 `triggered_by_ref` 不是本请求 / `action_key` 不在白名单 / run 状态不是 running 或 succeeded / 未兑换 / 同一授权第二次 `executed`（含 uuid 大小写写法；报 `authorization_already_used`）/ `no_publish = true` / `provider_ref = {}` / `human:` 邮箱与决策里的人对不上 → 全部被拒；`approved` 时决策已过期但已兑换 → 放行；`completed` 的下游 run 不是授权所属 run → 被拒；**`execution_item` 下游而授权所属 run 不是 `succeeded`（人点了“完成”）→ 被拒**。
- 观察型批准：`policy:` / `kernel:` 批准人 → `approver_invalid`；没有 `approval_requested` 直接批准 → 被拒；`review_ref.approved_by` 与邮箱对不上 / 为 `'unknown'` / 缺 `approved_at` → `approver_mismatch`；工单指针指向别客户 / 回链列不是本请求 / 状态还没到 `approved` → 被拒；**`review_ref` 缺 `approval_source`、取值不是 `me_review_route`（含 `airtable_sync`）、或 `approver_scope` 不是 `global_admin`（含 `scoped_admin`）→ `approver_source_invalid`**；受限演示管理员或 Airtable 路径批准的工单 → 过不了上一条，请求停在 `pending_pm_approval`（出待办）。**另对前置小 PR（§10 ②''）单测：审核路由写 `me_review_route` 与 `global_admin` / `scoped_admin`，同步器写 `airtable_sync` 且永不写路由那个值。**
- 观察型 `observed_live`：快照行属别的客户 / 不是广告级 / `effective_status` 不是 ACTIVE（PAUSED、DISAPPROVED、CAMPAIGN_PAUSED 逐个试）/ 不是此广告最新一行 / 12 小时内没有抓全的一轮（含 `skipped_shared`）/ 早于 `approved`；**账户 / 系列 / 广告组任一项不等于合同目标（含 1 美元测试广告投在别的广告组）、目标广告组预算超过合同上限 → `observation_target_mismatch`**；`ad_creative_links` 没有行 / 未解析（`unresolved`）/ `link_method` 不在内容绑定类 / 指向别的工单（包括“批准的是 A，下游被改成 B”）或别的客户 → `creative_link_missing`；**广告最早一行快照早于请求 → `ad_predates_request`**；**`downstream_ref.id` 不是 `approved` 回执批准的工单、或工单 `review_ref` 在批准后被改写（批准人 / 来源标记 / `approved_at` 对不上）→ `approval_downstream_mismatch`**；**同一成片在目标广告组里有两条以上都通过核验的广告：`ad_watch` 认领 → `observation_ambiguous`，`human` 指认其中通过核验的一条 → 成功，指认不通过核验的 → 被拒**；同一广告被第二个请求认领 → `ad_already_claimed`；调用方传了 `p_provider_ref` → `evidence_invalid`；下游不是 `work_order` → 被拒；带了授权字段 → 被拒；`actor = ad_watch` 带了 `approved_by` → 被拒。**119 的 `ad_creative_links` 写一次触发器（§12 第 11 条）：已解析的行被 `unresolved` upsert 覆盖 / 被改 `creative_ref` → 被拒（这条测试在 119 的 PR 里；台账这边的测试只验证“关联行被改写后观察核验不放行”）。**
- 绑定与回读：`downstream_ref` 指向别客户的 run、`triggered_by_ref` 对不上、`created_at` 早于请求、绑定时已是成功终态的旧对象、回链列被改写 → 被拒且库里什么都没变；请求表 `created_at` / `valid_until` 被伪造（直接 INSERT）→ 被拒（INSERT 权限已撤）；执行型 `executed` 之前、观察型 `approved` 之前重绑成功，之后被拒；**更换观察对象**：人批、对新快照整套重核、旧认领释放、新旧回执都在；已有 `reconciled` 后更换 → 被拒。
- `corrected`：想改 `provider_ref`（更换观察对象除外）/ **`source_ref` 里的指针（`approval`、`snapshot_ref`、`downstream`）** / 授权 / `no_publish` / `reconciled` 的 `result / evidence` / 更正一条更正行 / `actor` 不是 human / 没有 `human:` 批准人 → 被拒；成本缺省不替换、显式给才替换；内核同步器行（带 `action_run_id`）被更正成 `cost_usd > 0` → 被拒；`case_closed` 只能指向未结案的 `mismatch / unmeasurable` 链头。
- `reconciled`：**抢占攻击**——请求刚到 `fulfilled_observed` 就写 `reconciled`（任何入参）→ `reconcile_not_due`；到期后真对账照常写入；`actor` 不是 `reconciler` → 被拒；调用方想给 `result / evidence` → 被拒；日数据缺 → 得到 `unmeasurable`；**`match` 的新口径**：窗口最后 2 天都没花费 → `mismatch`（第一天花 5 美元、第二天被停）；最后 2 天有花费但窗口末前最近一行快照不是 ACTIVE → `mismatch`；两者都满足 → `match`；读不到账户时区 → `unmeasurable`（不退回 UTC）；窗口按账户时区切（悉尼 / 奥克兰 / 洛杉矶各一例，边界日不同）；链：第二条不带 `supersedes` / `supersedes` 不是链头 / 分叉 / **链头已是 `match` 或 `mismatch`（终局）仍想接续** → `reconcile_chain_conflict`；**接续距上一条不足 24 小时 → `reconcile_not_due`；同一窗口第 6 次接续 → `reconcile_chain_limit`**；其它请求类型 → `reconcile_not_enabled`；`mismatch / unmeasurable` 写入后出人工待办，`case_closed` 后待办消失。
- 请求创建：合同正文缺键 / 多余键 / 类型不对 → `contract_invalid`；`valid_until` 出界 → `valid_until_invalid`；幂等重放 → `replayed`；同键异合同 → `idempotency_conflict`；直接 UPDATE 不可变列（含属主身份）→ 被拒；第一条 `issued` 与请求同事务（中途失败两者都不在）。
- 幂等与并发：同键同载荷重放 → `replayed`；两个并发的同键调用 → 一个 `inserted` 一个 `replayed`；同键异载荷 → `receipt_key_conflict`；两版草稿 → 两行；事务中途失败 → 回执、请求行、发件箱都没写；同一请求两个并发不同阶段 → 串行化后按新状态判转移；两个并发请求认领同一广告 → 一个成功一个 `ad_already_claimed`；所有唯一冲突都翻成机器可读码（没有裸 23505 漏出去）。
- 时间：`expired` 在 `valid_until` 之前被拒；已 `executed` / `observed_live` 或授权已兑换的请求 `expired` 被拒；`executed / completed / observed_live` 过了 `valid_until` 仍能写；`next_due_at` 超限被截断。
- 监督：造超时、超 `hard_deadline_at`、无回执、缺对账（对账者自动补）、对账不一致（未结案才出待办）、发件箱漏发、已上线且过期、**权限被改回去（含 PUBLIC、列级授权）**、**属主名下多出一个引用台账表的函数**、**触发器被禁用（`DISABLE TRIGGER`）**、**同一请求多条候选广告（出“指认”待办，指认后消失）** 各一条 → 各出对应待办 / 补发；观察者在候选恰好一条且满足时写 `observed_live`、不满足时什么都不写、多于一条时不写。
- 清单对照：阶段清单（14）、**九态**、转移矩阵、`actor` 矩阵、`hard_deadline_at` 默认值、请求合同 schema 对照合同常量；静态扫描（辅助）；缓存重建（清掉请求行 `status / downstream_ref / observed_ad_id`，走重建入口补回）。

**先设计、不验收（W1 之外）**：执行型的整条路（等内核动作落地）；其余请求类型；内核同步器（只读扫 `action_runs where triggered_by='agent'`，翻译成台账行，**只放指针**，`cost_usd = 0`）；`launch`；回填 CTS 10-20 开投那条链、回填内核那 4 条 run。

## 10. 分工 / PR 顺序 / 风险级 / Tier
| 谁 | 交付 |
|---|---|
| 119 | 合同目录（**九态**、**14 个**阶段 / 事件名常量、按（模式, 状态, 阶段）的转移矩阵、各请求类型的合同正文 schema（**`creative` 合同含目标 `target = {ad_account_id, campaign_id, adset_id}`，可选 `max_daily_budget_cents`**）、`action_key` 白名单键名、请求类型含 `launch`）+ `ad_agent_requests` 迁移（含 `unique(request_id, client_id)`、`unique(client_id, idempotency_key)`、`status` 九态 CHECK）；**`ad_creative_links` 补链（PR 2990：建广告处写关联行、手建广告的登记入口、素材池条目 → 工单的绑定，含“解析成功的行写一次不可改”触发器，§12 第 11 条；74 号 10-21 已定 owner = 119）**；`ads.attach_creative`（A 级内核动作）的评估；广告 Agent 经 `ad_agent_create_request_v1` 发 `issued` |
| 122（我）| **⓪ 回链列迁移（独立第 0 步）**；台账迁移（随 PR，不在 PR 内 apply）：回执表与发件箱、三个写函数 + 只读核对函数与视图、权限与触发器、对 `ad_agent_requests` 的追加（不可变列触发器、`observed_ad_id`）；TS 外壳（含 `VerifiedReviewer`，编译期辅助）；`chain.ts` + 接口；监督函数（含权限与函数集合核对、观察者、对账者）；测试（含真 PostgreSQL）。DeepSeek 分轮写，我审 |
| 回链列写入点（子牙2）| **①执行项创建处**（`/execution` 路由 / 执行看板创建执行项的代码，owner 待 74 指派）；**②工单创建处**（106 / 121）。这两个“写入点 PR”**依赖第 0 步的加列迁移，先于台账迁移上线**，各自在创建时写 `agent_request_id`；没有它们，`accepted / linked` 的绑定核验永远失败 |
| **②' 创意类广告建广告处写关联（v0.6 提出，v0.7 定 owner）**| **owner = 119**（74 号 10-21 已定；设计在 PR 2990）。创意类广告建出来那一刻写 `ad_creative_links` 且**解析成功**：ME 内建广告路径（`ad-publisher.ts` 的 `publishDraftPaused` → `AdCreationPath` 补 `me_ad_launch`）、`boost_post_api` 接线，以及 **74 号用 Meta 工具手建广告的受限“登记”入口**（只收 `ad_id`，服务端读 Meta + 核验素材池得出绑定，不收人填的工单号）；`link_method` 为 `published_post_id` 或 `asset_binding`；**解析成功的行写一次不可改**（触发器，§12 第 11 条）。**没有它，观察型的 `observed_live` 今天一条都过不了**（§2）；落地前 W1b 如实报“没过”，不放宽核验 |
| **②'' 审核路由 / 同步器写批准来源标记（新，v0.7，复审高 2）**| 在 `review-apply.ts`（ME 审核路由用）与 `review-sync.ts`（Airtable 同步用）的 `applyApprove` 里，往 `review_ref` 加**不可省**的 `approval_source`（路由 `'me_review_route'`，同步器 `'airtable_sync'`，同步器永不写路由那个值）与 `approver_scope`（路由用 `requireGlobalAdmin()` 判：通过 `'global_admin'`，没通过 `'scoped_admin'`；同步器 `'unverified'`）。碰审核与鉴权，机器会判 A，走 A 级流程。owner 待 74 指派（改动很小，122 可代写；碰的是工厂审核路由，请工厂线 106 / 121 复核）。**必须先于台账迁移（③）合并，否则观察型 `approved` 永远过不了 `approver_source_invalid`** |
| 105 | 推广计划页的链路展示（读 `chain.ts` 接口）|
| 106 / 121 / 95 | 各自流程里调写入函数发阶段回执 |
| 74 | 合同验收、W1 验收、与 PM 沟通 |
**PR 顺序（v0.7）**：**⓪ 回链列迁移**（`execution_items.agent_request_id`、`content_work_orders.agent_request_id` + “只写一次”触发器；纯加列、不挂外键——此时 `ad_agent_requests` 还不存在，关联靠函数在绑定时核验；独立 PR，先于一切）→ ①119 的 `ad_agent_requests` 迁移与合同 → ②回链列写入点 PR（执行项创建处、工单创建处）、②'创意类广告建广告处写关联（119，W1b 的前提）与 ②''审核路由 / 同步器写批准来源标记（W1a 的前提）→ ③本台账迁移（两边迁移分开 PR、互不夹带）→ ④W1 链路接线 + 观察者 / 对账者。
**风险级 A**：新表 + 新 SQL 写入函数 + 权限收口 + 新 Inngest 函数 + 对外动作授权核验 + `fulfilled` 回读。子牙 + 魏征复审一次、实施后一次；PM 回“合 N”才合并（钉签字 SHA），apply 迁移另要 PM 显式 go。写代码默认 DeepSeek；库内函数与权限这类 A 级核心，按 `CLAUDE.md §5` 例外可由我自己写，PR 里写明原因。
**Tier（Inline）**：归位 Kernel / Governance / Verification 基础设施，不新增支柱、不新增能力线；共享代码里不出现客户名 / 行业词；时限常量是平台默认值，个别请求的差异走 `next_due_at`（受 `hard_deadline_at` 约束）。

## 11. 残余风险（诚实写明，库里管不到的）
- **持钥者伪造系统记录**：`service_role` 本来能直写 `action_runs`、`authorization_decisions`；观察型读的 `ad_entity_snapshots`、`ad_snapshot_captures`、`ad_creative_links`、`ad_daily_insights`、工单 `review_ref` 也都是 `service_role` 可写的。有钥匙又会伪造的人，可以造一条成功的 run 和一份已兑换的“人批准”决策，把执行型放行到 `fulfilled`；也可以造一整套“广告在投 + 内容绑定对得上 + 落在目标广告组 + 日数据有花费”的证据，把观察型放行到 `fulfilled_observed`。本设计防不住这个；要防得收口那些表的写权限，是各自的 A 级事项（§12(b)）。**v0.7 加的批准来源标记（`review_ref.approval_source / approver_scope`）同理：它能区分“哪条代码路径写的”（路由与 Airtable 同步器写的值不同，库里终于分得出），防不住持钥者直接改写这个 jsonb——所以这里如实写“降级”，不写成“已强制”。**
- **成功终态信任的是可变状态或外部观察**：执行项 `completed` 是人可以点的；工单 `approved…closed` 是工厂流程里的状态；观察型的“广告在投”来自 Meta 的抓取，库里验不了真伪。因此**这些成功终态不单独撑 W2 的“启用前”闸**——闸只认执行型的 `action_run` 回读（`fulfilled`）；**`fulfilled_observed` 永远不当闸的依据**。（v0.5 曾写“或 T+7 对账 `match`”，已删：对账读的是同一批系统表，对持钥者不构成独立证据；它能发现的是漂移——广告被停 / 删 / 从没花钱——不是伪造。v0.7 把 `match` 收紧成“窗口末仍在投”（最后 2 天有花费 ∧ 窗口末前最近一行快照仍是 ACTIVE），“第一天花了钱第二天被停”现在是 `mismatch`。）
- **广告与成片的绑定不是内容哈希**：`published_post_id` 靠“建广告那一刻记下的帖子 id 精确命中已发布工单”；`asset_binding` 靠“广告创意视频 ∈ 素材池条目 → 条目的 `work_order_ref`”，而 `work_order_ref` 由受限入口读 Meta 核对“视频存在 / 标题含工单 id 前 8 位 / 时间在工单之后 / 同一工单只绑一个条目”后写入——**标题前缀仍是人写的字符串**，所以 `asset_binding` 比 `published_post_id` 更弱（`provider_ref.link_strength` 如实标 `asset_pool_title`）。成片文件的内容哈希没入库，“这条广告里跑的就是被批准的那个视频文件”没有字节级证据。
- **批准人是“有库内记录但可变”**：观察型 `approved` 的 `human:` 邮箱来自已验证的内部员工会话，函数再核工单 `review_ref`；`review_ref` 是 jsonb，`service_role` 可改写；Airtable 路径写的批准人不是会话验证的，v0.7 起它在 `review_ref` 里带 `approval_source = 'airtable_sync'`，函数据此拒收（`approver_source_invalid`），该路径不产生台账 `approved`（§12(e)）。
- **平台回执号 / 观察线索的真伪库里验不了**（外部系统）：执行型靠授权真实且一次性 → 下游对象库内回读；观察型靠“最新快照 + 近期抓全 + 关联行 + 认领唯一 + T+7 对账（发现漂移）”。
- **“落在合同目标广告组”防的是误认，不是伪造**：目标由 119 的合同给；一个在目标广告组里手建、又被登记入口绑定到同一工单的广告，仍会成为候选——候选多于一条时不自动选，由人指认（§4 第 7 条）。**“广告晚于请求”用最早一行快照的时间近似**（盯盘表没有广告创建时间列），最坏误差一个抓取周期（6 小时）：请求发出前 6 小时内建的广告可能被当成之后建的；但它还得过“绑定到本请求批准的工单”那一关，而该工单创建晚于请求（§6），素材池条目的视频又晚于工单（PR 2990 §2），所以这条核验是兜底，不是唯一的防线。
- **属主身份 SQL 不受限**（迁移、SQL 编辑器、MCP 的 `execute_sql`）：DBA 通道，靠流程管；应用运行时不得用属主身份的直连连接串；常驻核对（§3.3 §8）只能发现“权限被改回去 / 属主名下函数集合或函数体变了”，发现不了变更当时的意图，也发现不了属主身份直接改数据。
- 阶段清单 / 转移规则 / 合同常量三处抄写（含九态、`actor` 矩阵、各请求类型的合同 schema），漂开只能靠矩阵对照单测发现；合同目录落地前本稿的映射是草案。
- 本稿所有规则在迁移 apply 之前都是纸面设计；A 级，apply 要 PM 显式 go，且先在一次性的测试库里把 §9 的用例跑一遍。

## 12. 给 119 的对齐项 与 剩余待办
**与 119 v0.4 §8 的差异（请她确认；其余语义全部沿用）**
1. 函数入参：119 稿是 `new_status` + `receipt_seq`；本稿改成 **`stage` + 函数体里的转移规则**（库里算，不信调用方，规则不放可改的表里）。保留的：`expected_old_status`、行锁、终态不可覆盖、乱序不倒退。`receipt_seq` 由函数在持锁时取。
2. **阶段词表 14 个**（不变，v0.5 起）；**状态词表由八态改九态：加 `fulfilled_observed`**（观察型终态，展示“观察到在投”；`fulfilled` 只留执行型）。请 119 回一句“同意”并写进合同常量与 `ad_agent_requests.status` 的 CHECK。**若她不愿加状态**，退一步：保持八态，请求表加一列 `closing_mode`（`executed / observed`），由函数在进入 `fulfilled` 时写，所有读 `fulfilled` 的地方必须同时读它——但“忘了读这一列”就会把观察型当成履约，是更弱的防线，我不推荐。
3. **请求模式**：`creative` = 观察型（本期），其余 = 执行型；`creative` 切到执行型需等 `ads.attach_creative`（A 级内核动作）落地并由 119 评估——请她在合同里给出模式表与每个请求类型的 `action_key` 白名单键名。
4. `downstream_ref`：沿用 `{kind, id, terminal_status}`，`kind / id` 由函数写并核验（执行型 `executed` 前、观察型 `approved` 前可重绑），`terminal_status` 只由函数回读后写；执行型下游只允许 `action_run` / `execution_item`。
5. `ad_agent_requests` 要加：`unique(request_id, client_id)`、**`unique(client_id, idempotency_key)`**、函数派生列 **`observed_ad_id`**（部分唯一，§3.3）、`status` 九态 CHECK；**请求创建改走 SECURITY DEFINER 函数 `ad_agent_create_request_v1`（规格见 §5.5，建议归 122 写：它要和 `issued` 回执同事务、共用台账的内部写入例程；各请求类型的合同正文 schema 由 119 的合同目录给，函数体抄写）：同事务写第一条 `issued` 回执、撤销 service_role 的 INSERT；若她不愿改，退而求其次用触发器强制 `created_at = now()`、`status = 'requested'`、`downstream_ref` 空、`valid_until ∈ (created_at, created_at + 30 天]`**；撤销 UPDATE / DELETE / TRUNCATE，并加**不可变列触发器**（§3.3）（这几条随我的迁移追加，她的迁移先合并即可）。
6. 幂等键：周期日取 **NZ 日期**写进合同；`failed / rejected / expired` 之后同周期重发的办法（`supersedes_request_id` 或把重发次数并进键）。
7. `valid_until`：过期 = 追加 `expired` 回执，**但已有 `executed / observed_live` / 授权已兑换的请求不得过期**；`approved` 须在 `valid_until` 之前；上限 30 天。
8. `hard_deadline_at` 默认值（74 号定）：budget 48h / audience 7 天 / creative 14 天 / page 14 天 / seo 30 天 / launch 空——写进合同常量，请 119 确认。
9. `launch`：本期不写台账行、不允许 `fulfilled`；W2 再定。
10. **观察型读的几张非 119 的表**：`ad_entity_snapshots / ad_snapshot_captures / ad_creative_links / ad_daily_insights`（§2）。请 119 在合同里写明“观察型请求依赖它们的哪些列”，以后改这几张表的人才知道会连累台账；`ad_creative_links` 的写入点是新前置条件（§10 ②'）。
11. **`ad_creative_links` 的两条硬要求（v0.7，复审中 5 / 6）**：①**解析成功的行写一次不可改**——触发器：当 `creative_ref` 已非空且 `link_method` 为内容绑定类时，任何会改变 `creative_ref / link_method / creative_source / post_id` 的 UPDATE（含 `persistLink` 的 `onConflict` upsert 覆盖）都报错；`unresolved → 解析成功`可以升级一次，反过来不行（PR 2990 §4 写的“已 resolved 的行不会被 unresolved 覆盖，只会在出现更强证据时更新”请收紧为“不改；要换走带 `created_by` 的回滚 / 回填路径并经 PM 授权”）；②内容绑定类 `link_method` 的取值集合 = `published_post_id`、`asset_binding`（与 PR 2990 一致），新增取值要同步改台账函数体里的集合（A 级迁移）。
12. **`creative` 合同要给目标（v0.7，复审高 3）**：`target = {ad_account_id, campaign_id, adset_id}` 必填（创意上线请求在发出时就知道要投在哪），可选 `max_daily_budget_cents`；`observed_live` 据此核验（§4 第 3 条）。请 119 在合同目录里加，并在 `ad_agent_create_request_v1` 的合同 schema 校验里要求。
13. **对 PR 2990 §6 两个问题的回答**：①观察核验**认内容绑定类**（`published_post_id` 与 `asset_binding`），`unresolved` 一律不放行——同意；`provider_ref.link_strength` 如实标 `post_id` / `asset_pool_title`。②“广告晚于请求”**不用关联行 `created_at`**，改用该广告在 `ad_entity_snapshots` 里最早一行的 `captured_at` 与请求 `created_at` 比（盯盘表没有广告创建时间列，Meta 的 `created_time` 没入库；近似的误差见 §11）。若 119 愿意把 Meta 返回的广告 `created_time` 写进关联行（登记入口读 Meta 时顺手就拿到），台账改用它，更准。

**剩余待办**
- **(a)** 创意上线的内核动作 `ads.attach_creative`（A 级，另开卡由 119 评估）：落地后创意类请求才切到执行型，同时把执行型的授权来源 / `action_key` 白名单 / 下游绑定补齐（一次 A 级迁移）。在此之前创意链走观察型，**不依赖任何新的授权来源**。
- **(b)** 内核表收口：`action_runs` / `authorization_decisions` 的写权限只留给内核函数（§11 第一条）。内核 A 级卡，PM 定，不在本稿范围。
- (c) 回链列写入点两个 PR 的 owner（§10）：执行项创建处待 74 指派；工单创建处 106 / 121。
- (d) 合同目录落地后，对照阶段清单与转移矩阵，更新 §5.3。
- **(e)** 批准路径（74 号 10-21 已定）：PM 只在 ME 审核页批准成片（10-20 SH3 就是在审核页批的），没有迹象还在 Airtable 批。观察型的台账 `approved` 只收 ME 审核路由写的批准（`review_ref.approval_source = 'me_review_route'` ∧ `approver_scope = 'global_admin'`，§4）；Airtable 同步路径批的、受限演示管理员批的，请求停在 `pending_pm_approval` 并出待办“请管理员在 ME 审核页确认”。**不再需要另做“确认批准”动作**；若以后发现 PM 实际常在 Airtable 里批，再回来加（同样走来源标记）。顺带：现有审核路由用 `requireAdmin`，限定单个客户的演示管理员也能批任何客户的工单，台账不接受这种批准人（`approver_scope = 'scoped_admin'`），路由本身要不要收紧不在本稿范围。
- **(f)** `ad_creative_links` 写入点：**owner = 119（74 号 10-21 已定）**，设计在 PR 2990（§10 ②'）。落地前 W1b 如实报“没过”。
- **(g)** 存量回填（CTS 10-20 开投那批等）：已存在的广告 / 工单 / 执行项不能事后绑到新请求（“创建晚于请求”是防抢认领的核验，不为验收放宽）；要回填须另设计“回填请求”（**74 号已定：A 级，PM 显式 go**），不在 W1。PR 2990 §5 的回填 dry-run 只回填关联行，不等于回填台账请求。
- **(h)** 前置小 PR ②''（审核路由 / 同步器写批准来源标记）的 owner（§10）：待 74 指派；它先于台账迁移合并，W1a 依赖它。
- **(i)** W1b 台账卡 `2026-10-21-agent-ledger-w1b-first-real-observation`：已随本稿开出（`verify_by` 先定 2026-11-04，②' 没落地就顺延并写原因）。
