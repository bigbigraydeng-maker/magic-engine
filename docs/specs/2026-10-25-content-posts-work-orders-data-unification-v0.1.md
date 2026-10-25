# 内容工厂 × 视频工厂 数据统一规格 v0.1

- 日期：2026-10-25 · 来源：Issue #3090（Ray 2026-10-25 14:49 NZDT 要求单独写）
- 性质：**只写文档**。不含迁移代码，不与入口 PR 混在一起。
- 风险级别：文档本身 C；**其中任何落库方案（方案 B/C）按 A 级对待**（改库结构）。
- 红线：任何 migration PR 由 Ray 亲自合并；在生产库跑迁移前，必须先把迁移方案贴到 #3090，由 Ray 本人拍板。
- 事实来源：仓库内 migration 与源码（HEAD `26dbbf9`）。**没有读过生产库**，所有"现有数据量/脏数据"一律标「未核实」。
- 平台层级（Inline）：属既有平台基础设施（Execution Kernel / 状态模型），不新增能力线、不新增支柱、无客户/行业硬编码；不登记候选。

---

## 0. 结论先行

1. **现在不迁移，不改两张表的结构。** 用「状态翻译层」（纯代码）把两边在显示时对齐成 11 个统一状态，即 #3090 第二节第 7 条已定的做法。
2. 仓库里**已经有**一份 5 段翻译（`src/lib/factory/content-stages.ts`：`stageOfContentPost` / `WORK_ORDER_STAGE`）。11 状态版本是在它上面**扩展**，不是另起一套。
3. 两张表**没有任何外键或字段相连**（见 §1.3）。翻译层只能把它们"排在同一条流水线上"，**不能**回答"这条工单是哪个选题做出来的"。要回答这个问题，需要一次加法式的改库（方案 C），建议等第 3 步（分发）真正需要时再做，且单独走 Ray 拍板。
4. 不推荐合并成一张表（方案 D）。

---

## 1. 两张表字段怎么对应

### 1.1 各自是什么

| | `content_posts`（内容日历 / 内容工厂看板） | `content_work_orders`（视频工厂工单，兼任务队列） |
|---|---|---|
| 建表 | `20260425000001_magic_engine_foundation.sql` | `20260711000002_p21j_content_factory_m1.sql` |
| 本质 | 一条"内容想法 → 文案 → 排期/发布"的记录，多平台、多形态（图文/视频） | 一条"为某个目标 + Master Brief 产出一支广告/Reel 视频"的生产任务，带租约、重试、成本上限 |
| 状态列 | `status` 5 值：draft / approved / scheduled / published / rejected | `status` 16 值（见 `src/lib/factory/types.ts` `WorkOrderStatus`） |
| 主要写入方 | 选题助理、Launch Hub、Airtable 旧同步、内容工厂看板 | 视频工厂生产 worker、审片、发布 worker |
| 引用它的代码 | `from('content_posts')` 约 47 个文件 | `from('content_work_orders')` 约 21 个文件 |

### 1.2 字段对应表

「—」表示该侧**没有**对应字段。

| 统一概念 | `content_posts` | `content_work_orders` | 对应关系 / 说明 |
|---|---|---|---|
| 主键 | `id` | `id` | 各自独立 uuid，**互不引用** |
| 客户 | `client_id`（NOT NULL，FK clients，CASCADE） | `client_id`（NOT NULL，FK clients，无级联） | 一致，可直接做跨表过滤 |
| 标题 / 角度 | `title`（NOT NULL） | `angle`（NOT NULL）+ `rationale_one_liner` | 语义相近：选题标题 ≈ 工单角度。**不要**把 `rationale_one_liner` 当标题 |
| 来源（为什么做） | `source_brief_id`→`master_briefs`；`source_keyword_id`→`keywords`；`execution_item_id`→`execution_items`（处方执行项）；`source`（kanban/manual/airtable/NULL） | `master_brief_id`→`master_briefs`（NOT NULL）；`goal_id`→`goals`（NOT NULL）；`signal_id`→`content_demand_signals`；`angle_source`(jsonb)；`agent_request_id` | **Master Brief 是两边唯一的公共引用**；处方执行项只在 posts 侧有，目标 `goal_id` 只在工单侧有。统一看板上"每张卡标出处方和 Master Brief"：Brief 两边都能取，处方只有 posts 侧能取，工单侧需经 `goal_id`/`signal_id` 间接找 |
| 形态 | `route`（route_a/b/c）、`format`、`ratio`、`platforms[]` | `order_type`（variant_from_winner / fresh_angle / clip_generation） | **不是同一个维度**，不做字段映射；统一看板另用"出片类型"显示（视频 / 图片 / 图文），由翻译层从两边推导 |
| 文案内容 | `script`、`caption`、`hashtags[]`、`visual_brief`、`revision_notes` | `brief`(jsonb)、`output`(jsonb) | posts 是列，工单是 jsonb；**不合并**，各读各的 |
| 视频 / 成片 | `source_video_url`；`visual_assets.post_id` 引用本表 | `output`(jsonb) 内含成片；`content_work_order_clips` 关联素材 | 统一看板的"有无视频"：posts 侧 = 有 `source_video_url` 或关联视频素材（现有 `hasVideo` 判定沿用 `content-stages.ts` 调用方），工单侧 = `output` 有成片 |
| 审核 | `status=rejected` + `revision_notes` | `in_review` / `review_rejected`；`review_ref`；`reject_category`；`reject_reason` | 工单侧审核更细（分类 + 清单）。**posts 侧没有分类**，统一看板只显示"打回 + 原因文本" |
| 排期 | `scheduled_at` | —（发布 worker 用 `publishing_started_at`、`next_retry_at`） | 排期概念只在 posts 侧；工单侧无"排期"，只有"已通过·待分发" |
| 发布时间 | `published_at` | `published_ref.published_at`（jsonb） | 取值路径不同，翻译层统一读成一个 `publishedAt` |
| 发布回执 | `publer_post_id`；`youtube_publish_receipts.content_post_id` | `published_ref`(jsonb: platform/page_id/post_id/video_id/permalink/**video_state**)；`youtube_publish_receipts.work_order_id` | 工单侧回执更完整，含 `video_state`（DRAFT / PUBLISHED）。**posts 侧没有"平台上是草稿还是已公开"这一信息**，见 §2 风险 R3 |
| 广告关联 | —（`ad_creative_links.post_id` 是 **text**，指平台帖子 id） | `published_ad_id`、`source_ad_id` | 与本次统一无关，只提醒：`ad_creative_links.post_id` ≠ `content_posts.id` |
| 成本 | —（`generation_context_snapshot`、`quality_score` 仅质量用） | `budget_cap_usd`、`actual_cost_usd` | 只有工单有成本；统一看板成本列对 posts 显示"—"，不得补 0 |
| 重试 / 租约 | —（渲染任务在 `content_factory_render_jobs`，`content_post_id` 无 FK） | `claimed_*`、`heartbeat_at`、`attempt_count`、`publish_attempts` 等 | 不映射，属各自内部机制 |
| 创建 / 更新 | `created_at`、`updated_at`（有触发器） | `created_at`、`updated_at` | 一致 |

### 1.3 两张表之间现在有没有连接

**没有直接连接。** 逐项核对：

- `content_work_orders` 没有 `content_post_id`；`content_posts` 没有 `work_order_id`。
- 间接路径只有 `content_factory_render_jobs.content_post_id → content_posts.id`（posts 的旧渲染路线，**无外键约束**，且它指向的不是工单）。
- `content-stages.ts` 注释里写的"桥：候选备料齐了才建一条工单"，**代码层面没有落成字段**；`topic-alignment-store.ts` 的 `content_topic_alignments` 也只挂 posts（`content_post_id` 主键）。
- `docs/specs/2026-10-18-three-doors-merge-design-v0.1.md` 第 143 行同样记录：已发布的 18 个工单是否带内容工厂内容，**没有表连接可证**。（该数字来自该文档，我未复核生产库。）

**含义**：看板上"出片 8 条"与视频工厂"8 条待审"不是同一批，是因为它们**数的是两张不相交的表**，不是同一批数据的两种说法。

---

## 2. 11 个统一状态怎么映射

沿用 #3090 第五节的 11 个统一状态。该表对若干真实存在的状态没有覆盖，下面补全并标出缺口。

### 2.1 完整映射

| 统一状态 | `content_posts` 怎么算到这里 | `content_work_orders` 怎么算到这里 |
|---|---|---|
| 1 选题 | `draft` | —（工单从备料之后才出现） |
| 2 备料 | `approved` 且**无视频** | —（见缺口 G1） |
| 3 出片中 | `approved` 且**有视频**（与 `content-stages.ts` 现行判定一致）；另见缺口 G2（旧渲染任务） | `queued` / `claimed` / `producing` / `rendered`（`rendered` 是历史停用态，只读，不再有代码推进它） |
| 4 卡住了 | —（posts 本身没有失败态；旧渲染 `content_factory_render_jobs.status='failed'` 属缺口 G2） | `failed` / `dead_letter` / `publish_failed` |
| 5 待审 | —（见缺口 G3） | `in_review` |
| 6 打回 | `rejected` | `review_rejected` |
| 7 已通过·待分发 | `scheduled`（已排期但未发，见缺口 G4） | `approved` / `publishing`（发布中，见缺口 G5） |
| 8 已分发（草稿） | —（posts 侧**无法判断**平台上是不是草稿，见风险 R3） | `published` 且 `published_ref.video_state = 'DRAFT'` |
| 9 已公开 | `published`（**前提**：确认走的是真发布；Publer 草稿是否会写成 published 未核实） | `published` 且 `video_state = 'PUBLISHED'` |
| 10 看表现 | —（posts 的表现数据不在本表） | `measuring` |
| 11 收尾 | — | `closed` / `archived` / `superseded` |

### 2.2 缺口（映射表自身没覆盖，需 Ray / Raybot 定）

| 编号 | 缺口 | 建议（保守默认，不猜） |
|---|---|---|
| G1 | 「备料」在工单侧不存在：工单创建时就带 brief，直接进 `queued` | 保持 posts 独有；工单不填，**不要**把 `queued` 当备料 |
| G2 | `content_factory_render_jobs`（posts 的旧渲染任务）有自己的 `status`（`queued` / `failed` 等，未列全，**未核实取值**）；#3090 说旧 Creatomate 渲染已于 09-23 停 | 翻译层第一版**不读**这张表，历史行视为"posts 不带出片信息"。若要读，须先核实其全部取值再补映射 |
| G3 | posts 没有「待审」：`draft→approved` 之间无审片步骤；视频审片只发生在工单 | posts 不进「待审」。统一看板"待审"列暂时只含工单 |
| G4 | `scheduled`（有 `scheduled_at`）在 11 态中无对应 | 暂归 7，并在卡上标"已排期 + 时间"；是否需要第 12 态由 Ray 定 |
| G5 | `publishing`（发布中，已被 worker 领取）介于 7 和 8 之间 | 暂归 7，卡上标"发布中"，**不得**显示为已分发 |
| G6 | `published` 的工单若 `published_ref` 缺失或未核实（`provisional`），既不是 8 也不是 9 | 沿用 `publishedBadge()` 现有措辞："发到一半中断（待人工核对）" / "已在平台上（公开状态未核实）"，统一状态记为 **8 且带"未核实"标记**，不猜成 9 |
| G7 | 11 态没有"整个目标已完成/被替换"的区分 | 同工单 `closed / archived / superseded` 一起归 11，卡上保留原词 |

### 2.3 实现约束（给后续写代码的人）

- 翻译函数放 `src/lib/factory/`，紧邻 `content-stages.ts`；对 `ContentPostStatus` 和 `WorkOrderStatus` 都要**编译期穷举**（`Record<…>` + `never` 默认分支），与现有写法一致，加状态漏映射就编译报错。
- 统一状态只用于**显示与统计**，**不得**写回任何表的 `status`，也不得被业务判断（发布、扣费、门禁）读取——业务逻辑仍读原始 `status`。
- 统一状态 8 与 9 的区分**只**依据 `published_ref.video_state`，复用 `publish-display.ts`，不得另写一套判断。
- 对于"已发布其实是草稿"这类歧义，宁可标"未核实"，不要默认成"已公开"。

---

## 3. 要不要迁移、怎么迁（方案对比）

先说明「迁移」指什么：为了让两张表**真能连起来**（回答"这条工单对应哪个选题"），可能需要加列、加关联表或加视图。

### 3.1 方案

| | 方案 A：只做翻译层（纯代码） | 方案 B：加数据库只读视图 `v_factory_unified` | 方案 C：加关联（桥接）表 / 关联列 | 方案 D：合并成一张新表 |
|---|---|---|---|---|
| 做什么 | 在 `src/lib/factory/` 里把两张表的行转成统一状态与统一卡片结构；两表并行读取 | 用 SQL `UNION ALL` 把两表投影成统一列，状态在 SQL 里翻译 | 新增 `content_post_work_order_links`（post_id、work_order_id、client_id、created_at、created_by），或给工单加可空列 `content_post_id` | 新建统一表，把两张表数据搬进去，旧表变视图或下线 |
| 改库 | **否** | 是（新增视图，不动数据） | 是（加表或加列，不改已有数据） | 是（大迁移 + 回填 + 双写） |
| 能解决"同一批数不一致" | 部分：能把两边排在同一看板，**不能**证明某工单来自某选题 | 同 A，且在 SQL 层统一，便于报表 | **能**：从此新建的工单可追溯到选题；历史数据需另行回填 | 能 |
| 历史数据 | 无需处理 | 无需处理 | 历史 18+ 条已发布工单**无法自动补链**（无依据，见 §1.3），只能人工认或留空 | 全量搬迁，易出错 |
| 对现有代码影响 | 新增模块，旧代码不动 | 新增读取点，旧代码不动 | 加法：旧代码不动；新写入点需要填链接 | 47 + 21 个文件都要改 |
| 风险级别 | B | A（改库结构） | A（改库结构） | A（最高，不推荐） |
| 与 #3090 已定原则 | 完全一致（第 7 条"前期不动底层表"） | 与"不改结构"的字面不冲突（只加视图），但仍是改库，需 Ray 拍板 | 属于"前期之后"的步骤 | **冲突**：明确不做 |
| 回滚 | 回退 PR 即可 | `DROP VIEW` | 删除新表/新列（数据全是新增，不丢原有数据） | 极难，需保留旧表与双写期 |

### 3.2 推荐路径

1. **现在（第 2 步）：方案 A。** 零改库，能立刻让两边出现在同一条 6 段流水线上，每张卡标出处方和 Master Brief（§1.2 已说明取值来源）。
2. **第 3 步（分发）真正需要"一个选题 → 多个渠道 → 多条工单"时，再评估方案 C。** 倾向**关联表**而不是给工单加列：
   - 一个选题可能对应多条工单（多渠道、重做）；一条工单也可能没有选题（广告 winner 变体）——多对多/可空更自然。
   - 关联表是纯新增，不改两张业务表，回滚最简单。
   - 但这是**改库**：届时按本文件红线流程，先贴迁移方案到 #3090，Ray 拍板，Ray 亲自合并。
3. **方案 B 暂不推荐**：视图只是把方案 A 的逻辑搬进 SQL，收益有限；而且状态翻译表要在 TS 和 SQL 里各维护一份，会出现两处不一致。除非后面有报表/BI 明确需要直接查 SQL。
4. **方案 D 不做。**

### 3.3 如果将来做方案 C，需要在迁移方案里写清的最小内容（先列清单，不写 SQL）

- 表名、列、唯一约束（防同一对重复链接）、外键与 `ON DELETE` 行为（**写明为什么**，避免重蹈 `baseline` 文档里"ON DELETE 是推断的"的问题）。
- RLS：按仓库规则用 service-role 模板，必须写 `FOR ALL TO service_role USING (true)`，不得漏 `TO service_role`；禁止 `workspace_id` / `client_team` / `auth.uid()`。
- 谁在什么时机写链接（工单创建点），以及失败时是否阻断建单（建议**不阻断**，链接缺失只影响追溯，不影响出片）。
- 历史数据：是否回填、依据是什么（没有依据就不回填，保持 NULL，统一看板显示"来源未知"）。
- 迁移前后的行数对账 SQL（只读）。

---

## 4. 风险和回滚办法

### 4.1 风险

| 编号 | 风险 | 影响 | 级别 | 对策 |
|---|---|---|---|---|
| R1 | 统一状态被当成真状态，被业务逻辑读取（如发布、扣费判断） | 误发布、误扣费 | 高 | §2.3 明确：只显示、不写回、不参与业务判断；代码审查检查点 |
| R2 | 看板数字被误读为"同一批"：posts 与工单合并显示后，同一支视频可能被数两次（先作为 post 的"出片"，再作为工单的"出片"） | 看板总数虚高、PM 误判产能 | 中 | 因为没有链接（§1.3）**无法去重**。第一版看板必须按来源分列/标注"内容日历"或"视频工单"，**不得**加总成一个数字；去重要等方案 C |
| R3 | posts 侧无"草稿 vs 已公开"信息，`published` 可能被显示为"已公开"但平台上其实是草稿 | 对外说"已发布"但客户看不到 | 高 | posts 侧 `published` 映射为 9 的前提需核实（Publer 草稿是否会写成 published，**未核实**）；核实前 posts 的 `published` 在统一看板标"已发布（公开状态未核实）" |
| R4 | 枚举漂移：任一表加新状态，翻译层漏映射 | 卡片从看板静默消失 | 中 | 编译期穷举 + 单元测试（沿用 `content-stages.test.ts` 的做法）；`STATUS_ORDER` 已有同类断言 |
| R5 | 统一状态 4"卡住了"把 `publish_failed` 与生产失败混在一起 | 处理动作不同（重发 vs 重做），点进去易走错 | 低 | 卡片保留原始状态词作副标题 |
| R6 | 若做方案 C：新建工单漏写链接 | 追溯缺口 | 中 | 链接缺失不阻断；加每日对账（缺链接的新工单数）。该对账属"以后才会自动跑"的任务，须按仓库规则当场试跑并写进 PR |
| R7 | 若做方案 C：历史工单被错误回填链接 | 把别人的选题挂到工单上，污染 Learning/归因 | 高 | 没有确定依据不回填；回填须人工逐条确认并留审计字段 |
| R8 | 若做方案 D：双写期间两表不一致 | 数据丢失/重复 | 高 | 不做 |
| R9 | `content_posts` 有触发器 `trg_sync_execution_item_on_post_published`（posts 变 published 时自动把关联处方执行项标 completed） | 若以后有代码通过"统一状态"去改 posts 的 status，会触发这条副作用 | 中 | 与 R1 同源：统一状态不写回；任何改 `content_posts.status` 的新代码必须评估该触发器 |

### 4.2 回滚

| 方案 | 回滚办法 | 数据是否受损 |
|---|---|---|
| A | 回退对应 PR；两张表没动过 | 否 |
| B | `DROP VIEW`，回退 PR | 否 |
| C | 回退应用代码 → 停止写入新链接 → 删除关联表（或删除新列）。因为是纯新增，原有两张表数据不受影响；链接数据丢失只影响追溯，可由写入日志重建（若 §3.3 的写入点有 receipt） | 否（只丢新增的链接） |
| D | 需保留旧表与双写、有对账脚本才能回滚；不推荐，不展开 | 可能 |

迁移本身（方案 B/C）的执行回滚要求，迁移方案贴 #3090 时须写：
- 迁移前：记录两表行数、按 `status` 分组计数（只读 SQL），作为基线；
- 迁移后：同一批 SQL 比对，结果必须完全一致（新增对象除外）；
- 回滚脚本随迁移方案一起贴出，并在非生产环境演练过一次再请 Ray 拍板；
- 不在生产库跑任何 `DELETE` / `UPDATE` 于两张业务表。

---

## 5. 与其他在途工作的边界

- **入口 PR（L9 + 标签页）**：只改入口、名称、标签，**不依赖**本文件的任何落库方案。标签页第一版里"选题 / 出片"若要并排显示两张表，只能用方案 A，且按 R2 分列显示。
- **#3090 第六节第 2 步（状态翻译层 + 看板）**：实现依据就是本文件 §2；写代码前需 Ray / Raybot 对 §2.2 缺口 G2、G4、G5 给结论，或明确"按保守默认"。
- **#3090 第六节第 4 步（系列从写死配置改成工单字段）**：这是对 `content_work_orders` 加列，**属改库**，不在本文件范围，另走同一红线流程。

---

## 6. 需要 Ray / Raybot 回答的问题（每条一句话能回）

1. §2.2 的缺口 G4：`scheduled`（已排期）要不要单独算第 12 个统一状态？默认：不加，归 7 并标"已排期"。
2. §2.2 的缺口 G2：第一版翻译层要不要读旧渲染任务表？默认：不读。
3. §3.2：认可"现在做方案 A，方案 C 等第 3 步再单独提"吗？

## 7. 未核实项（本文件刻意没有下结论的）

- 生产库中两张表的实际行数、状态分布、是否有脏数据。
- `content_factory_render_jobs.status` 的完整取值。
- posts 侧 `published` 是否可能对应 Publer 草稿。
- 已发布的 18 个工单与内容工厂内容的关系（来自 3-doors 文档，未复核）。
- origin/main 未刷新（本地快照 HEAD `26dbbf9`）。
