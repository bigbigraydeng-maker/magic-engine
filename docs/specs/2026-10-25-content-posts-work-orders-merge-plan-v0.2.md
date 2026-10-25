# 内容工厂 × 视频工厂：两张表合成一张（合并规格 v0.2）

- 日期：2026-10-25 NZDT · Issue #3090 · 只写规格，**不含 migration 代码**
- 方向来源：Ray 2026-10-25 14:56 NZDT「最好可以合并呀。别自己让自己麻烦」
- 取代：同日 v0.1（分支 `claude/issue-3090-20261025-0150`）里的"只做翻译层 / 关联表 / 只读视图"几个并存方案。本版只讲**真合并**，不设计两张表并存的同步层或桥接表。
- 风险级别：**A 级**（改库表 + 触及签字/发布链路）。migration PR 由 Ray 亲手合；生产库执行前，把最终迁移脚本贴回 #3090，由 Ray 本人拍板。
- 核实范围：只读了仓库里的 migration 和代码。生产库只有 RLS 策略做过只读核实（见 §8 第 2 条），行数、状态分布、脏数据仍未核实（见 §8）。origin/main 未刷新，仅本地快照 `26dbbf9`。

## 1. 结论（一句话）

**留 `content_work_orders`，把 `content_posts` 的数据搬进去，之后 `content_posts` 停用。** 一张表、一套存储状态、一个显示翻译函数。

## 2. 为什么留工单表（而不是留帖子表）

| 比较项 | 留 `content_work_orders` | 留 `content_posts` |
|---|---|---|
| 要改的代码文件 | 帖子侧 47 个文件改指向 | 工单侧 21 个文件改指向，但要把整套领取/心跳/重试/发布回执搬进帖子表 |
| 外部依赖它的东西 | 出片片段表、需求信号表、广告素材签字（`creative_binding_attestations`）、哈希历史、成本流水、YouTube 发布回执，都按工单 id 挂着 | 帖子只被：执行项、生产包、图片素材（`visual_assets.post_id`）挂着 |
| 状态机 | 已有 16 态 + 原子领取 + 超时回收 | 5 态，无队列语义 |
| 迁移动作 | 加列、放宽几个必填、搬帖子行 | 加约 25 列、重建整套队列索引、再把 6 张依赖表改指 |

关键点：**工单 id 被广告签字链路（A 级）用作凭证**。把它们搬走等于动签字链路；把帖子搬进来只是**往里加行**，签字链路一行不用改。所以留工单表改动最少、风险最小。

## 3. 字段怎么对应（帖子 → 工单）

原则：**搬进去的帖子行保持原来的 `id`**。这样所有外键值（执行项、生产包、图片素材）不用逐行换算，只需要改"指向哪张表"。

| `content_posts` 字段 | 去向（`content_work_orders`） | 备注 |
|---|---|---|
| `id` | `id`（原值） | uuid 不会冲突 |
| `client_id` | `client_id` | 同名 |
| `title` | `angle` | 工单必填，帖子标题即选题角度 |
| `source_brief_id` | `master_brief_id` | 同含义；工单侧改为可空 |
| `route`（a/b/c） | 新列 `route`，可空 | 工单没有，保留 |
| `platforms` | 新列 `platforms text[]`，可空 | 分发渠道，后续分发步骤要用 |
| `format` / `ratio` | 新列同名，可空 | 出片类型和比例（图片也是一种类型） |
| `scheduled_at` / `published_at` | 新列同名，可空 | 工单现在把发布时间放 `published_ref` 里；帖子的两个时间保留为列，新代码以后统一读列 |
| `source` | 新列 `source`，可空 | 标记来源（选题助理 / 手工 / 社媒计划等） |
| `source_keyword_id` | 新列同名，带原外键 | 关键词来源，A 类证据链，不进 jsonb |
| `execution_item_id` | 新列同名，带原外键 | 处方执行项回链，触发器要用（见 §6） |
| `production_item_id` | 新列同名 | 生产包来源 |
| `script` `caption` `hashtags` `visual_brief` `revision_notes` `source_video_url` `publer_post_id` `airtable_record_id`、质量快照分数 | 放进 `brief` jsonb 的固定键 | 不单独加列，避免工单表继续变宽；键名在实施 PR 里集中定义一份类型 |
| 无 | `order_type = 'organic_post'`（新取值） | 与广告三类工单并列 |
| 无 | `goal_id` 放宽为可空；`angle_source` `rationale_one_liner` 给默认值；`budget_cap_usd` 对 organic 设 0 | 加检查约束：**广告类工单仍必须有 goal_id**，不放松广告侧 |
| `created_at` `updated_at` | 同名 | 原值保留，不重置 |

另加一个只读追溯列 `legacy_post_id`？**不加**。因为 id 保持不变，追溯靠 id 即可；少一列少一个误用点。

**工单侧本来就有、帖子没有的**（队列、成本、回执、打回原因、发布重试等）对 organic 行全部留空或默认值，不影响。

## 4. 11 个统一状态怎么映射

存储层只在工单表现有 16 态上**新增 2 个取值**：`draft`（选题）、`prepping`（备料）。其余保持原样。显示层的 11 状态由**一个函数**从这一张表推出，不再有第二个数据源要翻译。

| 统一状态 | 存储（工单表） | 帖子旧值如何落到这里 |
|---|---|---|
| 1 选题 | `draft` | 帖子 `draft` |
| 2 备料 | `prepping` | 帖子 `approved` 且没有视频/图片成品 |
| 3 出片中 | `queued` / `claimed` / `producing` / `rendered` | 无（organic 以前不走队列） |
| 4 卡住了 | `failed` / `dead_letter` / `publish_failed` | 无 |
| 5 待审 | `in_review` | 帖子 `approved` **且已有成品**：一律落在这里，**要重新过审**，不沿用旧批准（宁可多审一次，不让旧批准绕过新质检） |
| 6 打回 | `review_rejected` | 无 |
| 7 已通过·待分发 | `approved`（含 `scheduled_at` 有值时标"已排期"） | 帖子 `scheduled`：**一律退回此状态**，旧 `scheduled_at` 不沿用，由人重新排期（Ray 已定，见 §9 第 1 条） |
| 8 已分发（草稿） | `publishing` / `published` 且回执 `video_state = DRAFT` | 无 |
| 9 已公开 | `published` 且回执 `video_state = PUBLISHED` | 帖子 `published`：**回执为空，无法证明是否公开**，显示为"公开状态未核实"，不猜（Ray 已定，见 §9 第 2 条） |
| 10 看表现 | `measuring` | 无 |
| 11 收尾 | `closed` / `archived` / `superseded` | 帖子 `rejected`：选题被否、从未出片，落 `superseded` 并把原因写进 `reject_reason`（`reject_category = 'other'`） |

注意：
- 统一状态**只用于显示**，不参与发布、扣费、授权判断；这些判断只认存储状态和回执。
- 存储状态里 `draft`/`prepping` 不可被发布 worker 领取：它只扫 `approved` / `publish_failed` / `publishing`（见 `idx_cwo_publish_queue`），所以新值天然不会被误发。**这一点需要实施 PR 用测试钉死**。

## 5. 迁移步骤（四步，全部可单独回退）

| 步 | 内容 | 动数据？ | 谁合 |
|---|---|---|---|
| M1 | 加法 migration：新增列、放宽 `goal_id`/`master_brief_id` 可空、`order_type` 与 `status` 的检查约束加新取值、广告类仍要 `goal_id` 的检查约束 | 否（只改结构，现有行不变） | Ray 亲手合 |
| M2 | 回填：先满足下方「M2 前置条件」两条，再把 `content_posts` 每行按 §3/§4 **复制**进工单表（`INSERT … SELECT`，保持 id）；`content_posts` **原样保留，不删不改** | 只新增行 | Ray 拍板后在生产执行 |
| M3 | 切换代码：新建一个共享读写模块（建议 `src/lib/content-items/`），47 个帖子侧文件分批改走它；改完一批就合一批；同时把触发器（§6）改挂工单表；改外键指向（§6） | 否 | 普通 PR（含 A 级复审） |
| M4 | 停用旧表：确认一个周期无人读写后，把 `content_posts` 改名 `content_posts_archived` 并撤销写权限；**不 DROP** | 否 | Ray 亲手合 |

**切换窗口怎么避免"两边都写"：** M2 回填后到 M3 全部切完之前，是唯一的并存期。办法是 M3 **按功能整块切**（写入口先切，同一个 PR 内读也一起切），不允许"一半路由写旧表一半写新表"；并在 M3 第一个 PR 加一条仓库测试：`src/` 里出现 `from('content_posts')`（白名单之外）就失败，用来保证切完之后没有残留。回填后若旧表又有新增行，M3 最后一个 PR 前**重跑一次增量回填**（按 id 去重，幂等）。

**M2 前置条件（两条都满足，才允许首次回填）：**

1. **发布 worker 类型隔离先上线。** 现有 `src/lib/factory/publish/publish-worker.ts`（约第 43–44 行领取、约第 195–200 行审核回执检查）只按 `status` 领取，不过滤 `order_type`；若回填出的 `approved` organic 工单被它领到，会因没有审核回执被改成 `publish_failed`，而不是停在「已通过·待分发」。所以在 M2 之前，必须先合并并部署一个小 PR：worker 的领取查询（及 sweeper 等其他按状态扫工单的消费者）加 `order_type` 白名单（只认广告类），并用测试钉死「`approved` 的 `organic_post` 不会被领取」。若来不及，替代办法是 M2 期间**暂停发布 worker**（关其 cron/调度），回填并核对完再恢复；暂停与恢复的时间要记在 #3090。两种办法至少选一种，验收是回填后 `organic_post` 行状态仍为 `approved`、无一变 `publish_failed`。
2. **回填期间冻结旧表写入，不做「边写边同步」。** `src/app/api/posts/[id]/route.ts` 等入口仍可修改旧表已有行（文案、状态、执行项关联），按 id 去重的增量回填只补新增 id，搬不走这些更新，行数对账也发现不了。本规格选「暂停写入」而不是设计冲突同步：M2 开始前先上一个小改动，让 `content_posts` 的写入口（新增、修改、删除）返回「迁移中，暂不可编辑」（读不受影响）；冻结从回填开始，直到 M3 的写入口切换完成并解冻（指向新表）。冻结期间不应有任何写入落到旧表。核对不止行数：回填完成后对每个 id 比对旧表与新表的 `updated_at` 和关键字段（`title`→`angle`、状态映射结果、`execution_item_id`、`brief` 里的文案键）的校验哈希，差异为 0 才算过；有差异则在冻结状态下重跑回填修正，不带差异进入 M3。冻结窗口由 Ray 在 #3090 确认起止时间。

## 6. 旧代码怎么切换（具体点名）

1. **外键改指向（M3，一个 migration 一条条改）**
   - `execution_items.content_post_id` → 改指 `content_work_orders(id)`（值不变）
   - `production_items.content_post_id` → 同上
   - `visual_assets.post_id` → 同上；**注意它现在是 `ON DELETE CASCADE`（推断值，见基线文件注释），改指后要保持同样语义，并在实施前从生产读出真实行为**
   - 这几条是红线级改动，每条 migration 单独贴 #3090。
2. **触发器**：`trg_sync_execution_item_on_post_published`（把执行项标完成 + 写日志）要在工单表上重建一份，条件改为"status 变成 `published` 且 `execution_item_id` 非空"。**漏了它，处方执行项不再自动完成**，Tune 回写断线。回滚时要能恢复旧触发器。
3. **读写模块**：新建一个读写入口，函数名按"内容项"而非"帖子/工单"命名；旧的 `stageOfContentPost` / `stageOfWorkOrder`（`src/lib/factory/content-stages.ts`）合并成一个 `stageOf(item)`，在那里实现 §4 的 11 状态。
4. **切换顺序（每步一个小 PR）**：①内容工厂看板与 `content-factory/*` 路由 ②`posts/*`、`content/route-*` ③`social-plan/save-to-board`、`workbench-summary`、`dashboard/page` ④Inngest（`maliang-render-check`、`libai-copy-provenance`、`factory-creatomate-render`）与 `lecture-*` ⑤`pm-todo/*`、`flywheel` 适配器、`mcp/*scoped-queries` ⑥门卡与 portal 页。**每个 PR 都要保持"打开页面不退化"**。
5. **旧路由和旧地址保留**（待办里有直链），只换底层数据源。
6. **不改**：`boundaries.ts`、workflows、凭证、广告签字链路。

## 7. 回滚办法

| 出问题的阶段 | 回滚 |
|---|---|
| M1 之后 | 新增列是可空的，现有代码不认识也不受影响；回滚 = 反向 migration 删新列、恢复约束（脚本随 M1 PR 一起放 `docs/migrations-rollback/`） |
| M2 之后 | 旧表没动。回滚 = 删除"id 属于旧表且 `order_type = 'organic_post'`"的行。这一步**是对生产表的 DELETE**，所以先在非生产演练，并先导出一份被删行的备份；删除条件必须精确，不能出现无条件 DELETE |
| M3 切换中 | 代码回退到上一个 PR 即可读回旧表。**但切换后新增的 organic 行只在工单表里**：回退前要先把这些行反向复制回 `content_posts`（脚本随 M3 第一个 PR 提供并演练过）。这是整个方案最需要小心的一步 |
| M4 之后 | 改回表名、恢复写权限。因为没 DROP，数据还在 |

迁移前后必须做**行数对账**：旧表行数 = 工单表里 `organic_post` 行数；按状态分组各组数一致；抽样比对标题、客户、时间。对账不平不许进下一步。

## 8. 风险

1. **不知道生产里有多少数据、多脏**（行数、空 `client_id`、重复 id、非法状态值）。M2 前必须只读查一遍，结果贴 #3090。
2. **行级安全策略（已更正）**：生产已只读核实：两张表 RLS 开启，各只有 `service_role_full` 一条策略，roles = `{service_role}`，匿名访客会被拒；只是仓库 migration（`20260711000002_p21j_content_factory_m1.sql:150`）写的 `FOR ALL USING (true)` 没带 `TO service_role`，和生产不一致，M1 里显式写成 `FOR ALL TO service_role USING (true)`。
3. **触发器断线**（§6.2）。
4. **图片素材外键行为是推断值**（§6.1）。
5. **旧批准失效**：帖子里"已批准且有成品"的会重新进待审，短期会让待审队列变长；这是有意的 fail-closed 选择。
6. **共享表语义**：工单表原本围绕广告工厂（`budget_cap_usd`、`published_ad_id`）。organic 行进来后，所有现有的"扫工单"代码（发布 worker、sweeper、广告素材池 `creative-pool-labels`）必须按 `order_type` 过滤，否则 organic 行会混进广告流程。需要在 M3 前逐个核对这 21 个文件。
7. 大小：M3 预计超过 800 行，必须拆成上面 6 个顺序 PR。

## 9. Ray 已定

Ray 2026-10-25 15:14 NZDT「三条都按你的建议同意」（已记在 #3090；本次推进经 ME Video 转达）：

1. 旧的"已排期（scheduled）"帖子迁移时一律退回"已通过·待分发"，由人重新排期，旧排期不沿用。
2. "已发布"但没有公开证据的，显示"公开状态未核实"。
3. M1→M4 四步批准。M1、M4 的 migration PR 由 Ray 亲手合；M2 在生产执行前先把脚本贴到 #3090。

## 10. 本规格没做的事

- 没写任何 migration / 回填 / 切换代码。没读生产库。没合并、没部署、没发布、没花广告费。
- 旧渲染任务表 `content_factory_render_jobs` 不在本次合并范围（v0.1 的默认：不读不并），要并另起一份。
- 验证：文档变更，未运行测试和 build。

## Reuse Statement

- 复用：现有工单表的状态机、领取/发布 worker、广告签字链路、`content-stages.ts` 的穷举护栏思路。
- platform-shared：一张表 + 一个 `stageOf` 函数 + 内容项读写模块。
- industry-specific：无。client-specific：无；没有客户名或客户 id 写进共享代码。
- 学习/记忆：本规格不涉及。
