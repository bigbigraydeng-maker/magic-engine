# Creatomate 成片 → 人工授权 → 原生发 Facebook Reel → 首评 CTA → T+4/T+72 成绩回收 · spec v1

> ⛔ **已被 v2 取代**：[`2026-09-15-creatomate-reel-publish-spec-v2.md`](./2026-09-15-creatomate-reel-publish-spec-v2.md)（子牙 + 魏征设计审查后按协调方裁决 D1–D16 与生产探针 X1/X2/X4 重写）。本文件仅保留作审查记录，**不得据此实现**。

> 起草：Claude Code · 2026-09-15 · 状态：**设计稿，未写任何业务代码 / migration / 路由 / Inngest 函数**
> 基线：`git fetch origin` 于 2026-09-15 01:45 NZST，`origin/main` = `f9c8f3aa5dad51ff5f593edce329833e260a91d3`（含 #1686）
> 风险级别：**A 级**（对外发布不可逆副作用 + 幂等/状态机 + 新 Inngest 工作流 + 客户可见外发）
> Tier：**既有社媒支柱「发布」能力延伸 + L3 Meta Connector（`facebookReelAdapter`）复用**，不新增能力线，不登记 `platform-candidates.md`（§11）
> IMPACT 落点：**Act**（发 Reel + 首评）→ **Check**（T+4 / T+72 回收）。**Tune 本期不接**（§9）
> 审查状态：**设计阶段两审（子牙 + 魏征）尚未进行**——本 PR 为 Draft，审完修订后才进入实现（CLAUDE.md 铁律 4）
> 前情：[`2026-09-09-creatomate-connector-spec-v1.md`](./2026-09-09-creatomate-connector-spec-v1.md)（出片段）、PR #1424（Reel 发布信号）、PR #1431（Reel 测量接线）、PR #1686 + issue #1692（排期帖成绩回收与其遗留）

---

## 0. 一句话

Creatomate 做出来的片子现在停在看板「出片」列，**没有任何代码能把它发出去**。本设计补一条闭环：FDE/PM 在出片抽屉里看片、看正文、看首评、逐句标来源，点「授权发布」形成一条可审计的授权记录 → 一个新的 Inngest 工作流拿着这条授权记录，复用现成的 `facebookReelAdapter` 原生上传成 Reel → 发完自动发首评（带 UTM 的 CTA 链接）→ 复用现成的 Reel 测量接线收 T+4 / T+72 成绩。任何一步失败都进今日待办，且待办里写的动作在系统里真有按钮能点。**不改 `content_work_orders` 那条广告工单发布线的行为。**

---

## 1. 现状核实（2026-09-15，自己重新读过代码，逐条附位置）

| # | 事实 | 位置 |
|---|---|---|
| F1 | 唯一的 Reel 发布 worker 只从 `content_work_orders` 领活，CAS 靠该表的 `status` + `publishing_started_at` / `publish_claimed_by` / `next_retry_at` / `publish_attempts` 这些**只有工单表才有**的列 | `src/lib/factory/publish/publish-worker.ts:36-61` |
| F2 | 适配器三步上传（start → rupload `file_url` → finish），`onStarted(videoId)` 在上传前回调落幂等锚；`findExisting` 靠 caption 末尾零宽标记（id 前 8 位 hex）扫最近 25 条 Reel；另有 `promoteReelToPublished` 草稿转正不重传 | `facebook-reel-adapter.ts:15-24, 87-162, 170-195` |
| F3 | 安全阀 `FACTORY_PUBLISH_LIVE`：未设 = 只发 DRAFT；**全局变量**，同时控制工单线和讲课片线 | `src/app/api/cron/factory-publish-worker/route.ts:24`、`src/lib/factory/lecture-publish.ts:109` |
| F4 | 三落库是 publish-worker 私有函数，且 `vendor` 写死：facebook → `'oztop_facebook'`（CTS 走 facebook 也会被记成 Oztop，**既有红线 2 残留**） | `publish-worker.ts:308-366`（`:317`） |
| F5 | 发布信号 `me/factory.reel.published` schema 强制 `work_order_id`；事件 id `me-factory-reel-<wo>-<video>`；Graph `permalink_url` 是相对路径 `/reel/<id>/`，builder 已补全 | `reel-published-event.ts:51-71, 83-85, 104-112` |
| F6 | 补发对账只扫 `content_work_orders` | `publish-worker.ts:417-438` |
| F7 | 测量适配器用 `payload->>work_order_id` 回查 `factory_reel_publish` 动作行做身份重绑（`.maybeSingle()`，同一 wo 多行会抛错），幂等键 `factory-reel:<wo>:<video>`，登记 `social.publish_post`（`source='factory_reel'`）+ fan-out `daily_plan.post.measure_due` T+4/T+72 | `factory-reel-measurement-adapter.ts:43-45, 75-106, 129-172, 204-282` |
| F8 | 测量只读 reactions / comments / shares；Reel 永远不返回 shares（记 `omitted_unverified`，PM 2026-09-07 接受） | `src/lib/meta/post-engagement.ts:91-125`、memory `reference-meta-reel-measurable-metrics-without-read-insights` |
| F9 | 看板「满意·去发布」= `PATCH action:'schedule'` 把 `content_posts.status` 无条件改成 `scheduled`，**没有 CAS、没有审核人、没有授权记录**；`reject` 同样无 CAS（一条已发布的帖子也能被改回 rejected） | `src/app/api/clients/[id]/content-factory/[postId]/route.ts:34-38, 114-132` |
| F10 | `content_posts.status` 的 CHECK 只有 `draft/approved/scheduled/published/rejected` 五值，**没有「发布中」状态**；表有 `updated_at` 触发器；status 改成 `published` 时有触发器同步关联 execution_item | `supabase/migrations/20260425000001_magic_engine_foundation.sql:82-104, 131`、`20260518000003_execution_content_link.sql:40-70` |
| F11 | Creatomate 成功只写 `content_factory_render_jobs.status='ready_for_review'` + `content_posts.source_video_url`，**不写 caption**，帖子仍是 `approved` → 看板「出片」列 | `src/lib/inngest/functions/factory-creatomate-render.ts:225-239`、`src/lib/factory/content-stages.ts` |
| F12 | 已经有一条「content_posts → Facebook Reel」的发布先例：讲课片（`format='讲课式'`，状态放 `generation_context_snapshot.lecture_publish_request`，搭在 factory-publish-worker cron 上扫）。但它：①不是 Inngest；②没有 `onStarted` 幂等锚；③没设 `expect_brand` 防误发；④`sending` 超过 20 分钟**会自动重发**（注释原话「宁可重发一次」，`lecture-publish.ts:258-260`）；⑤发完不落三本账、不发发布信号、不进测量 | `src/lib/factory/lecture-publish.ts` 全文 |
| F13 | 通用挂片路由 `video/route.ts`：`link` 动作走 `normalizeRecordingLink` + `safeProbeRemoteFile` 逐跳探活，`attachVideo` CAS `status='approved'`；`uploaded` 动作要求路径严格是 `<client>/final/<post>/final-<ts>.<ext>` | `src/app/api/clients/[id]/content-factory/[postId]/video/route.ts:67-81, 164-202` |
| F14 | 看板没有「直接新建一张卡片」的入口：content_posts 只由 `generate`（从爆款改写，status=draft）、intake-runner、LinkedIn 进度贴等写入；而 draft → confirm 对 `render.engine='creatomate'` 的客户**会立刻排 Creatomate 渲染（花钱）** | `content-factory/generate/route.ts:36-50`、`[postId]/route.ts:174-195` |
| F15 | 鉴权 `requireDashboardClientAccess` 返回 `user`（有 `user.id`）+ `role`（`admin` / `client-viewer`）；付费客户本人（`client-viewer`）也能调这些看板路由 | `src/lib/auth/client-access.ts:18-100` |
| F16 | 既有「发布授权记录」先例：Daily Plan 发布收据带 `publishing_authorization:'AUTHORIZED'` + `approved_by_user_id` + `review_revision`，存 jsonb，没加表 | `src/lib/campaign/daily-plan-publish.ts:136-160` |
| F17 | 发评论唯一现成函数 `replyToComment` 失败一律 `return null`（PITFALLS F6 反模式），不能直接复用做首评 | `src/lib/meta/comments.ts:180-206` |
| F18 | CTS 当前 Meta 授权 scope（2026-09-06 生产实测）**不含 `pages_manage_engagement`**；以主页身份发评论通常需要这个 scope | memory `reference-cts-factory-reel-native-publish` |
| F19 | Tune 两处写死 `source='daily_plan'`；广告归因只认 `content_work_orders` | `src/lib/flywheel/tune/social-post-cohort.ts:81`、`campaign-daily-plan/tune-suggestions/route.ts:62`、`src/lib/ads/creative-link.ts:67, 156` |
| F20 | 今日待办已有 `creatomate_render_failed`，但它的 how 写的是「充完回我一句」「直接找我重跑」——跟 #1686 第二轮被打回的是**同一种不可执行 how**（既有欠账，本期不修，§9 登记） | `src/lib/pm-todo/manual-items.ts:666-698` |

---

## 2. 最小契约：新 Inngest 函数复用适配器，不给 publish-worker 加第二个领活来源

### 2.1 三个方案对比

| 维度 | A：publish-worker 加第二个领活来源（content_posts） | B：content_post 桥接成一条 content_work_order，交给现有 worker | **C：新 Inngest 函数 + 复用适配器与抽出的纯 helper（选定）** |
|---|---|---|---|
| 原子认领 | content_posts 没有「发布中」状态和租约列（F10）；要么加 migration，要么在 454 行文件里写第二套 jsonb CAS，两套认领规则共用一个 `processOne` | 天然有 CAS（F1） | 在 `content_posts` 上做乐观锁 CAS（`status` + `updated_at` + 快照子键状态，§3.2），每一步独立 step |
| 防重复发帖 | `markFailed` 带指数退避**自动重试 3 次**（`publish-worker.ts:151-173`）——对「上传中途失败」这一类，重试靠 `provisional` 锚兜底，但语义是「默认会重来」 | 同左 | 函数级 `retries: 0`（memory：Inngest 重试只能函数级），**上传中途失败一律进「待核对」，永不自动重发**（§3.4） |
| DRAFT 安全阀 | 共用全局 env | 共用全局 env | env **且** 授权记录里的 `mode`（§4.3），两者都说 live 才发 live |
| 三处落库 | 复用私有函数，但 `vendor` 写死 `oztop_facebook`（F4） | 同左，且 CTS 的内容会被记成「广告工单」 | 抽出 `writeFactoryReelBooks({ vendor })`，工单线传原值（**行为不变**），新线传 `'meta_graph'` |
| 补发对账 | 要给 `reconcileMissingReelEvents` 加第二张表查询 | 复用 | 新增 `reconcileContentReelFollowups()`，挂在同一条 factory-publish-worker cron 的独立 try 里（§5.4） |
| 语义 | 混两种来源进一个状态机 | **拒**：`content_work_orders` 是「广告创意疲劳后出变体」工单（`OrderType` 三值），2026-09-09 spec §1.2 已判定不通用；桥接会让一条普通内容同时出现在两套看板状态里 | 普通内容走普通内容的状态，工单走工单 |
| CLAUDE.md 铁律 3「跨步骤接力 + 外部副作用默认 Inngest」 | 不满足（cron 轮询） | 不满足 | 满足 |
| 执行预算 | 与工单、讲课片共用一条 cron 的 300 秒，一轮一条 | 同左 | 每个 step 一个请求；FB 拉大文件慢也只占自己那一步 |

**结论：选 C。** 不碰 publish-worker 的领活逻辑；只把它里面四段本来就该共享的纯逻辑抽出来（行为不变，由现有 `publish-worker.test.ts` 锁住）：`resolveTarget`（含 `expect_brand` 防误发）、`scanPublishCaption`（红线闸）、`validateVideoUrl`、`writeThreeBooks`（加 `vendor` 参数，工单线默认值保持 `oztop_facebook`，F4 的错误值另开 backlog，不在本期顺手改）。

**为什么也不复用讲课片那条路（F12）**：它会自动重发、没有幂等锚、没有防误发、不进测量。本期**不改**讲课片线（范围外，§9 登记它的「超时自动重发」为 A 级 backlog），但新线不继承它的规则。

### 2.2 新增的最小组件清单（实现阶段的上限，不是起点）

| 组件 | 类型 | 说明 |
|---|---|---|
| `src/lib/factory/content-reel/state.ts` | 纯函数 | 快照子键 `reel_publish` 的类型、状态迁移表、CAS 条件构造、hash/指纹计算 |
| `src/lib/factory/content-reel/authorization.ts` | 纯函数 + 读库 | 构造授权记录、校验授权记录完整性（hash 重算） |
| `src/lib/factory/content-reel/cta.ts` | 纯函数 | 首评文本 + UTM 拼装（参数全部来自客户配置 / 帖子行） |
| `src/lib/factory/publish/shared.ts` | 抽出 | §2.1 抽出的四段 helper |
| `src/lib/meta/page-comment.ts` | L3 Connector 小扩展 | `postPageComment()` / `findOwnComment()`，失败返回带原因码的结果，不吞成 null（F17） |
| `POST /api/clients/[id]/content-factory/[postId]/reel-publish` | 路由 | `action: 'authorize' \| 'authorize_promote' \| 'reconcile' \| 'confirm_manual_comment' \| 'resend'` |
| `POST /api/clients/[id]/content-factory/import-video` | 路由 | 只建一张 `approved` 空卡片（§8），挂片仍走现成 `video/route.ts` |
| `cloud-factory-content-reel-publish` | Inngest | 领授权 → 预检 → 上传 → 落回执（`retries: 0`） |
| `cloud-factory-content-reel-followup` | Inngest | 三本账 → 发布信号（`retries: 3` + `onFailure`，全部幂等） |
| `cloud-factory-content-reel-first-comment` | Inngest | 首评（`retries: 0`，内部有界尝试） |
| `cloud-factory-content-reel-reconcile` | Inngest | 人点「重新核对 Facebook」时只读查询（`retries: 2`） |
| `factoryReelMeasurementAdapter` | 改 | 事件 schema 加 v2 分支（§5） |
| `src/lib/pm-todo/content-reel-items.ts` | 新 | 今日待办五种（§7），接进 `loadManualItems` |
| 看板出片抽屉 | UI | 授权表单 + 状态徽标 + 三个按钮（§4.1、§7） |

---

## 3. 状态机、原子认领与防重复发帖

### 3.1 当前状态放哪：`content_posts.generation_context_snapshot.reel_publish`（不加 migration）

理由：`content_posts` 是这条内容的唯一行；这一列已经被用作「有边界子键」（`endcard` / `offer_key` / `lecture_publish_request`），读写规则现成；Daily Plan 的授权收据也是 jsonb（F16）。历史（每次运行一条、不可覆盖）放 `cron_run_logs`（§4.4）。

```ts
// src/lib/factory/content-reel/state.ts（形状示意，实现时以 zod 为准）
type ReelPublishState =
  | 'authorized'          // 人点了授权，工作流还没领
  | 'claimed'             // 工作流领到了，正在预检（还没碰 Graph 写接口）
  | 'preflight_failed'    // 预检没过，Graph 一次写都没发生 → 可重新授权
  | 'uploading'           // 已拿到 video_id（onStarted 落锚），上传/finish 进行中
  | 'in_doubt'            // 拿到 video_id 之后出错 → 不知道 FB 上有没有 → 只能核对，禁止自动重发
  | 'draft_published'     // 草稿已在主页后台（不公开）
  | 'promoting'           // 草稿转正进行中
  | 'published'           // 已公开
  | 'not_on_facebook'     // 核对确认 FB 上没有这条（或已被删）→ 可重新授权

interface ReelPublishSnapshot {
  schema_version: 1
  state: ReelPublishState
  attempt_id: string            // = 当前授权记录的 authorization_id
  authorization: ReelPublishAuthorization   // §4.2
  history: Array<{ attempt_id: string; final_state: ReelPublishState; video_id: string | null; at: string }> // 上限 20 条
  video_id?: string
  page_id?: string
  video_state?: 'DRAFT' | 'PUBLISHED'
  permalink?: string            // 已补全成绝对网址（复用 normalisePermalink）
  published_at?: string
  error_code?: ReelPublishErrorCode   // 固定原因码，不拼 Graph 原文
  error_detail?: string               // 人话，给抽屉显示
  first_comment?: { state: 'pending' | 'posted' | 'failed' | 'manual_required' | 'manual_confirmed' | 'not_applicable'; comment_id?: string; error_code?: string; confirmed_by_user_id?: string; at?: string }
  followup?: { books_written: boolean; published_event_ids: string[]; at?: string }
  updated_at: string
}
```

### 3.2 原子认领（CAS）

所有写 `reel_publish` 的地方都用同一个 helper `casPatchReelPublish()`：

1. 读行：`status`、`updated_at`、`source_video_url`、`generation_context_snapshot`；
2. 在内存里校验「期望旧状态」（如 `state === 'authorized' && attempt_id === event.attempt_id`）；
3. 只替换 `reel_publish` 子键，其他子键原样带回（与 `ensurePostFieldsWritten` 同一原则）；
4. `UPDATE … WHERE client_id = ? AND id = ? AND status = ? AND updated_at = <第 1 步读到的值>`；
5. 命中 0 行 = 别人先改了（包括别的功能改了别的子键）→ 重读一次再判；第二次仍不满足期望旧状态 → 放弃，返回 `cas_lost`，**不发任何 Graph 写请求**。

`updated_at` 由触发器在每次 UPDATE 时刷新（F10），因此它就是行版本号：同一行上任何并发写都会让 CAS 落空，堵住「读-改-写」丢失其他子键的问题。

> 🔴 前置核实（实现前必须做，只读）：生产库里 `content_posts_updated_at` 触发器真实存在且函数体是 `NEW.updated_at = now()`（memory「对象在≠内容跟仓库一样」）。**若不存在或被改过**，本方案的 CAS 不成立，改走 §3.6 的加表方案，届时需 PM 授权 apply。

### 3.3 状态迁移与谁能触发

| 从 | 到 | 触发者 | 附加 CAS 条件 |
|---|---|---|---|
| （无）/ `preflight_failed` / `not_on_facebook` | `authorized` | 授权路由（人） | `status='approved'`（首次）或 `status='scheduled'`（重新授权）；`source_video_url` = 表单提交时看到的 URL |
| `authorized` | `claimed` | 发布函数 | `attempt_id` = 事件里的 `attempt_id` |
| `claimed` | `preflight_failed` | 发布函数 | — |
| `claimed` | `uploading` | 发布函数（`onStarted`） | — |
| `uploading` | `published` / `draft_published` | 发布函数 | — |
| `uploading` / `promoting` | `in_doubt` | 发布函数 `catch` 或 `onFailure` | — |
| `claimed` / `uploading` 超过 30 分钟未变 | （不改状态）→ 今日待办「卡住」 | 待办扫描 | — |
| `in_doubt` / `uploading`(卡住) | `published` / `draft_published` / `not_on_facebook` | 核对函数（人点「重新核对」） | — |
| `draft_published` | `promoting` | 授权路由 `authorize_promote`（人，新的 authorization_id） | `video_id` 等于表单看到的 |
| `promoting` | `published` | 发布函数 | — |

同时：`content_posts.status` 在首次授权时 `approved → scheduled`；只有 `video_state=PUBLISHED` 落回执那一步才 `scheduled → published`（触发 F10 的 execution_item 同步）。

**看板现有 PATCH 的补丁（同一 PR 必须做，否则状态机能被绕过）**：`schedule` / `reject` 加 CAS——`schedule` 只允许从 `approved`；`reject` 只允许从 `draft/approved`，且 `reel_publish.state` 不在 `authorized/claimed/uploading/in_doubt/promoting/published/draft_published` 时才放行（F9）。

### 3.4 幂等键定义

| 用途 | 键 | 为什么这样定 |
|---|---|---|
| 授权 → 发布事件 id | `content-reel-publish:<content_post_id>:<authorization_id>` | 每次授权一个新 uuid。撤回/删帖后重新授权是新 id，**不会被 Inngest 24 小时去重吞掉**（#1686 `:resolve:<photoId>` 同一教训） |
| 草稿转正事件 id | `content-reel-promote:<content_post_id>:<authorization_id>` | 同上 |
| 适配器零宽标记 `idempotencyTag` | `authorization_id`（不是 `content_post_id`） | 若用帖子 id，「换片后重新授权」时 `findExisting` 会认出**旧片**的草稿并把它当成这次的结果（讲课片线正是用帖子 id，F12）。标记只有 32 位、只扫最近 25 条，碰撞概率可忽略，但 §10 有 mutation 锁「用错 id 必红」 |
| 发布信号事件 id（v2） | `me-factory-reel-cp-<content_post_id>-<video_id>` | 同一条 Reel（含草稿转正，video_id 不变）只喊一次；重新上传必然是新 video_id |
| 测量幂等键（v2） | `factory-content-reel:<content_post_id>:<video_id>` | 撤回后原样重发 → 新 video_id → 新键，**不撞 `flywheel_actions_social_publish_idempotency` 唯一索引**（issue #1692 第 1 条的教训）；工单线 `factory-reel:<wo>:<video>` 一个字不改 |
| 首评事件 id | `content-reel-comment:<content_post_id>:<video_id>` | 每条公开 Reel 至多一条首评流程 |
| 跟进事件 id | `content-reel-followup:<content_post_id>:<video_id>` | 补发对账重发同 id |

### 3.5 Graph 上传中途失败怎么处理

按「是否已经拿到 `video_id`」一刀切：

- **没拿到 `video_id`**（`start` 之前或 `start` 本身报错）：主页上不可能出现公开内容（没 finish 就不会发布）→ `preflight_failed`（`error_code: 'start_failed'`），允许重新授权。
- **拿到了 `video_id`**（`onStarted` 已落锚）之后任何异常（rupload 失败、finish 超时、网络断、函数被杀）：→ `in_doubt`，**绝不自动重发**。函数 `retries: 0`；`onFailure` 兜底把 `claimed/uploading/promoting` 改成 `in_doubt`。人从待办进抽屉点「重新核对 Facebook」→ 核对函数只读查询：
  1. `GET /<video_id>?fields=id,status,permalink_url,published`（字段形状以实现前一次只读探针的真实返回为准，§12 未证实假设 U4）；
  2. `findExisting({ idempotencyTag: authorization_id })` 交叉确认；
  3. 查到且公开 → `published`（补落回执、补发跟进事件）；查到是草稿 → `draft_published`；Graph `code 100 + error_subcode 33` → `not_on_facebook`（可重新授权）；其他错误 → 保持 `in_doubt`，抽屉显示原因码，待办继续挂着。
- `findExisting` 在**正式上传前**也跑一次（与工单线同规矩）：查到本 `authorization_id` 的标记 → 不上传，直接进 `in_doubt` 走核对（按设计不该发生，发生了说明重放或并发出了问题，交人看）。

### 3.6 若必须加表（仅当 §3.2 前置核实失败时启用，需 PM 授权 apply）

`content_reel_publish_attempts(id uuid pk, client_id, content_post_id, authorization jsonb, state text CHECK(...), video_id text, receipt jsonb, created_at, updated_at)` + 部分唯一索引 `UNIQUE (content_post_id) WHERE state IN ('authorized','claimed','uploading','in_doubt','promoting')`，RLS 按 `FOR ALL TO service_role USING (true) WITH CHECK (true)` 模板。单列理由：数据库层保证「一条内容同时只有一个进行中的发布」，不依赖触发器。**默认不走这条**。

---

## 4. 发布授权：人工审核 ≠ 发布授权

### 4.1 谁、在哪、点什么

- **在哪**：看板 → 出片列卡片 → 抽屉底部。客户配了 `factory_config.publish_target`（facebook + page_id）时，「满意 · 去发布」替换为「审核并授权发到 Facebook」表单；没配发布目标的客户保持现状（`schedule` 仅表示「我自己手动去发」，不触发任何自动发布）。
- **谁**：`requireDashboardClientAccess` 通过 **且** `role === 'admin'`（内部 FDE/PM，含单客户受限管理员）。付费客户本人（`client-viewer`）看得到状态，**不能授权**（F15）。
- **表单里必须看到并确认的东西**（服务端渲染预览，授权时一并回传做比对）：
  1. 成片播放器（`source_video_url`）+ 预检指纹（HEAD 得到的 `content-length` / `etag` / `last-modified`）；
  2. 发布目标：主页名（服务端用页 token 现查）+ page_id，页名与客户品牌不符直接禁用按钮（复用 `assertBrandMatches`）；
  3. 正文（可编辑，预填见 §6.1）；
  4. 首评文本 + 最终落地页 URL（含 UTM，只读展示拼好的结果）；
  5. **逐句来源标注**：正文和首评按句拆开，每句必须选「官网可溯（填页面 URL）/ brief 可溯 / 未证实」；**有任何一句「未证实」，授权按钮禁用**（CLAUDE.md 铁律 8 / PITFALLS D2 落成产品约束，不靠人记）；
  6. 红线扫描结果（`scanPublishCaption` 对正文 + 首评各跑一次；命中即禁用）；
  7. 发布方式：默认「草稿（不公开）」；只有服务端报告 `FACTORY_PUBLISH_LIVE=true` 时才出现「正式公开」选项，且选它时二次确认文案写明「发出去撤不回，客户主页所有粉丝可见」；
  8. 首评方式：服务端读 `platform_oauth_connections.scopes`，缺 `pages_manage_engagement` 时显示「这个主页的授权不能自动发评论，发布后需要手动发首评」并把 `first_comment_mode` 定为 `manual`（F18）。

### 4.2 授权记录（写入 `reel_publish.authorization`，同时进 `cron_run_logs` 历史）

```ts
interface ReelPublishAuthorization {
  schema_version: 1
  authorization_id: string                 // uuid，= attempt_id
  kind: 'publish' | 'promote'
  authorized_by_user_id: string            // access.user.id
  authorized_by_email: string
  authorized_role: 'admin'
  authorized_at: string
  client_id: string
  content_post_id: string
  render_job_id: string | null             // Creatomate 出的片才有；手动挂的片为 null
  target: { platform: 'facebook'; page_id: string; page_name_seen: string }
  mode_requested: 'draft' | 'live'
  video: { url: string; content_length: number; etag: string | null; last_modified: string | null; fingerprint_sha256: string }
  caption_text: string                     // 发布时用这份，不再读 content_posts.caption
  caption_sha256: string
  first_comment: { mode: 'auto' | 'manual' | 'none'; text: string | null; text_sha256: string | null; landing_url: string | null; utm: Record<string, string> | null }
  sentence_sources: Array<{ field: 'caption' | 'first_comment'; index: number; sentence: string; source: 'website' | 'brief'; ref: string }>
  redline_scan: { hits: string[]; scanned_at: string }
  promote_of_video_id?: string             // kind='promote' 必填
}
```

- **fail-closed 规则**（发布函数第一步就查，任一不满足 → `preflight_failed`，不碰 Graph）：记录缺失 / `schema_version` 不认识 / `authorization_id` ≠ 事件 / 两个 sha256 重算不一致 / `sentence_sources` 覆盖不到每一句 / `redline_scan.hits` 非空 / 视频指纹与现场 HEAD 不一致（`video_changed_since_authorization`）/ 页名与品牌不符。
- 发布时正文 = `caption_text`，首评 = `first_comment.text`：**审的就是发的**，授权之后在别处改 `content_posts.caption` 不会被带上去。
- 与「满意·去发布」的关系：旧按钮只代表「人觉得片子可以」，从来不是授权；本设计里它只在「客户没配发布目标」时保留，语义改为「手动发布」，永远不会触发自动发布。

### 4.3 DRAFT 安全阀

实际发出方式 = `mode_requested === 'live' && process.env.FACTORY_PUBLISH_LIVE === 'true'`（在发布函数「上传」那一步当场读 env）。两者任一不是 live → DRAFT。回执里记 `mode_requested` 和 `env_live_at_publish` 两个值，事后能看出为什么发成了草稿。env 的**首次**开启和本线**首条**公开发布都需要 PM 在对话里显式 `go`（§10.3）。

### 4.4 机器可读回执

| 字段 | 值 |
|---|---|
| `request_id` | Inngest `event.id` |
| `client_id` / `content_post_id` / `render_job_id` | 来自授权记录 |
| `authorization_id` / `authorized_by_user_id` | 来自授权记录 |
| `authorization` | `'AUTHORIZED'`（缺记录时根本不会走到发布，回执写 `'MISSING'` + `preflight_failed`） |
| `no_publish` | `true`（DRAFT）/ `false`（公开） |
| `mode_requested` / `env_live_at_publish` | §4.3 |
| `page_id` / `video_id` / `video_state` | Graph 返回 |
| `permalink` | 用 `normalisePermalink` 补成 `https://www.facebook.com/reel/<id>/`（相对路径坑，F5） |
| `status` | 最终 `ReelPublishState` |
| `error_code` | 固定枚举（`authorization_invalid` / `video_changed_since_authorization` / `brand_mismatch` / `redline_hit` / `no_page_token` / `graph_permission` / `start_failed` / `upload_failed_after_start` / `finish_failed_after_start` / `cas_lost` …） |
| `provider_impact` | `{ graph_write_calls: n, video_created: boolean, public: boolean }`（花费恒为 0，Graph 不计费） |
| `cost_usd` | `0` |
| `created_at` / `finished_at` | ISO |

存放：①当前值写 `reel_publish`（抽屉与待办读它，拉模式）；②每次运行一条历史写 `cron_run_logs`，`job_name` 静态字面量 `factory-content-reel-publish` / `…-followup` / `…-first-comment` / `…-reconcile`，在 `UNSCHEDULED_CRON_ROUTES` 登记（同 `creatomate-render`，`src/lib/cron/registry.ts:247`）。**业务失败（预检没过、待核对）记 `completed` + `summary.outcome`，只有函数自身崩溃才记 `failed`**——避免 issue #1692 第 5 条「每条业务失败都被每日 cron 摘要当成故障发邮件」。

---

## 5. 测量接线：从 work_order 泛化到 content_post

### 5.1 发布信号 `me/factory.reel.published` 加 v2 分支（不改 v1）

```ts
const V1 = FactoryReelPublishedEventSchema                       // 原样保留，work_order_id 必填
const V2 = V1.omit({ schema_version: true, work_order_id: true }).extend({
  schema_version: z.literal(2),
  source_kind: z.literal('content_post'),
  content_post_id: uuidLike,
  authorization_id: uuidLike,
})
export const FactoryReelPublishedAnySchema = z.union([V1, V2])
```

- 为什么不另起一个事件名：这个事件的承诺是「一条 Reel 公开了，下游（测量、将来的自动建广告）按 `page_id + video_id` 取用」；内容来源不同不该让下游订两个事件。
- 为什么是 union 而不是把 `work_order_id` 改成可选：v1 的「必须有 work_order_id」是测量身份重绑的前提，改成可选等于削弱工单线的校验。Inngest 里已经在飞的 v1 事件照旧解析。
- 本仓库内唯一消费者是测量适配器（已 grep 确认，F5）。

### 5.2 身份重绑按来源分叉

```ts
// factory-reel-measurement-adapter.ts
if (d.schema_version === 1) → rebindFactoryReelAction(...)            // 原函数，一行不动
if (d.schema_version === 2) → rebindContentReelAction(supabase, {
  clientId, contentPostId, videoId, pageId, publishedAt,
})
// 查询：action_type='factory_reel_publish'
//   AND payload->>content_post_id = contentPostId
//   AND payload->>video_id       = videoId          ← 必须带 video_id：同一帖子重发会有多行，只按帖子 id 查 .maybeSingle() 会抛错
// 校验与 v1 同一套：client / page / video / platform=facebook / video_state=PUBLISHED / published_at 相等
```

- 幂等键：v1 `factory-reel:<wo>:<video>` 不变；v2 `factory-content-reel:<content_post_id>:<video_id>`。
- `registerReelPublishAction` 的 `payload.source` 仍写 `'factory_reel'`（下游按来源读的 Tune 本期不接，保持一个值，将来 Tune 读 Reel 时不用认两个名字），额外写 `content_post_id`、`own_comment_count`（首评成功 = 1，否则 0）。
- ⚠️ 测量口径提醒：主页自己发的首评会被计进 comments 总数。`own_comment_count` 让以后读成绩的地方能减掉；**测量消费者本身不改**，T+4 / T+72 仍只承诺 reactions + comments（F8）。

### 5.3 三本账（跟进函数写，发布信号之前）

`writeFactoryReelBooks({ vendor: 'meta_graph', payload: { content_post_id, authorization_id, render_job_id, ...ref } })`。写之前先按 `(content_post_id, video_id)` 查 `factory_reel_publish` 是否已有，有就跳过——跟进函数有重试，必须幂等。**顺序固定**：三本账（至少 `flywheel_actions` 那一行成功）→ 发布信号。`flywheel_actions` 写失败时抛出让 Inngest 重试，**不**像工单线那样吞掉继续发信号（否则测量适配器必然 `action_not_found`，静默没成绩）。`fde_work_logs` / `execution_items` 仍是尽力而为。

### 5.4 补发对账

`reconcileContentReelFollowups()` 挂进 `factory-publish-worker` cron（新开一个独立 try，与讲课片、工单对账并列，`route.ts:45-54` 同一写法）：
- `reel_publish.state='published'` 且 `followup.published_event_ids` 为空、`published_at` 早于 15 分钟 → 重发 `content-reel-followup:<post>:<video>`；
- `state='authorized'` 超过 10 分钟没有被领（授权路由发事件失败）→ 重发授权事件（同 id，发布函数有 CAS，重复也只发一次）。
一轮上限 10 条，只查最近 7 天。

---

## 6. 正文、首评 CTA 与 UTM

### 6.1 文案从哪来、谁写

| 内容 | 来源 | 谁写 | 人审时怎么看到 |
|---|---|---|---|
| 正文（caption） | 预填：`content_posts.caption` 若有；为空（Creatomate 成片现状，F11）时用**确定性模板**拼：`title` + 客户配置里的「首评引导句」（§6.2）。**本期不接 LLM 起草**（避免在对外文案上引入幻觉，留作后续） | FDE 在授权表单里改写 | 表单正文框 + 逐句来源 |
| 首评文本 | 客户配置的首评模板 + 落地页（带 UTM） | 系统拼，FDE 可改前缀句，URL 部分只读 | 表单首评框 + 拼好的完整 URL |
| 落地页 | ①这条内容标了 `offer_key` 且 `offers[offer_key].landing_url` 有值 → 用它（单团素材 → 该团页）；②否则 → `factory_config.verified_cta.url`（客户级已验证落地页，泛讲/多团 → 列表页）；两者都没有 → 首评禁用、授权按钮禁用并提示去设置页补 | 配置由 FDE 在设置页填；单条内容可在表单里从这两个候选中选 | 表单下拉 |

授权后正文、首评都以授权记录里的快照为准（§4.2）。

### 6.2 客户规则放配置，不进共享代码

`clients.factory_config.publish_rules`（新子对象，**同一 PR 在 `FactoryConfigPanel.tsx` 补表单**，铁律 8）：

```jsonc
{
  "cta_placement": "first_comment",        // 'first_comment' | 'caption' | 'none'
  "caption_cta_line": "👉 Full itinerary in the comments",
  "first_comment_template": "👉 {landing_url}",
  "utm": { "source": "facebook", "medium": "organic_social", "campaign": "cts-golden-china-202609" }
}
```

- 共享代码只认识占位符与键名，不认识「CTS」「china-tours」「organic_social」这些值。`publish_rules` 缺失 → 授权按钮禁用 + 提示「先在设置页配发布规则」（不猜默认值）。
- `utm_content` 由代码确定性生成：`reel_<content_post_id 前 8 位>`，可在表单里改成可读名（如 `gc_beijing_reel`），但必须全客户唯一（授权时查同客户已发布的 `utm.content`，撞了拒）。
- `cta_placement='first_comment'` 时校验正文**不含任何 URL**（FB 自然 Reel 正文链接不可点，PM 2026-07-23 规则）。

### 6.3 首评发布步骤（`cloud-factory-content-reel-first-comment`，`retries: 0`）

触发：跟进函数发完发布信号后 `step.sendEvent` `me/factory.content_reel.first_comment_due`（只对 `video_state=PUBLISHED` 且 `first_comment.mode='auto'`；DRAFT 不发评论；`manual` 直接把 `first_comment.state` 置 `manual_required`）。

1. `step.sleep` 1 分钟（Publer 先例的延迟，给 Reel 处理时间）；
2. 身份复核：读 `reel_publish`，`video_id` / `page_id` / `attempt_id` 与事件一致、状态仍是 `published`，否则停；
3. 先查再发：`findOwnComment(<page_id>_<video_id>, tag)`——拉该帖评论，`from.id === page_id` 且文本含零宽标记 `encodeIdemTag(authorization_id)` → 已发过，直接记 `posted`；
4. `postPageComment(<page_id>_<video_id>, text + tag, pageToken)`；
5. 失败按原因码分：`graph_permission`（#10/#200、缺 scope）、`token_invalid`（190）、`object_not_ready`（100 非 33）、`object_not_found`（100+33）、`network/timeout`。只有 `object_not_ready` / `network` 在函数内有界再试（+5 分钟、+15 分钟，每次先重复第 3 步查重）；
6. 仍失败 → `first_comment.state='failed'` + 原因码 → 今日待办（§7）。**帖子已发出，绝不因为首评失败去删帖或重发帖。**

> ⚠️ 未证实：以主页身份 POST `/<page_id>_<video_id>/comments` 对 Reel 可用、且需要 `pages_manage_engagement`（U2、U3）。CTS 当前 scope 没有它，**首发大概率走 `manual`**，这是预期的安全路径而不是故障。

---

## 7. 可见性：每个失败终态都进今日待办（铁律 3 下半）

新文件 `src/lib/pm-todo/content-reel-items.ts`，**拉模式**直接查 `content_posts`（`generation_context_snapshot->reel_publish->>state` 过滤，近 14 天，分页读全，读失败抛出不返回空数组——PITFALLS F9），接进 `loadManualItems`（独立 `.catch`，同文件既有写法）。**每条 how 里点的按钮在抽屉里真实存在**（本 PR 一并做），不出现「回我一句」「找开发」。href 统一指向该卡片抽屉的深链 `https://app.magicengine.com.au/dashboard/clients/<client_id>/content-factory?post=<content_post_id>`（实现时确认看板支持 `?post=` 打开抽屉，不支持就同 PR 加上——否则 href 只能到列表页，how 要多写一步「找到标题为 X 的卡片」）。

| kind | 判据 | what（问题 + 影响） | how（真能做） | href |
|---|---|---|---|---|
| `content_reel_publish_blocked` | `state='preflight_failed'` | 「{客户} 的视频《{标题}》没有发出去：{error_detail}。Facebook 上什么都没发生，这条片子在等人处理」 | 按原因码分：`brand_mismatch`/`no_page_token`/`graph_permission` → ①打开链接 →「客户设置」→「平台连接」→ 点「连接 Meta」，用能管理 {page_name} 的账号授权；②回到这张卡片点「审核并授权发到 Facebook」重新授权。`video_changed_since_authorization`/`redline_hit`/`authorization_invalid` → 打开卡片，核对片子和文案后重新点「审核并授权」 | 设置页 或 卡片深链 |
| `content_reel_publish_in_doubt` | `state='in_doubt'` | 「{客户} 的视频《{标题}》上传到一半出错了，**不确定 Facebook 主页上有没有这条**。系统不会自动重发，以免同一条片子发两次」 | ①打开链接，点卡片里的「重新核对 Facebook」，等 1 分钟刷新；②显示「已发布」或「草稿在后台」→ 这条待办会自己消失；③显示「Facebook 上没有」→ 点「审核并授权发到 Facebook」重新发；④仍显示「待核对」→ 打开 `https://business.facebook.com/latest/content_calendar?asset_id={page_id}`，在 Reels 里找视频编号 {video_id}：找到就在卡片里点「重新核对」再试一次，找不到就点「标记为 Facebook 上没有」（仅管理员可见，写授权人 id） | 卡片深链 |
| `content_reel_publish_stuck` | `state in (claimed, uploading, promoting)` 且 `updated_at` 早于 30 分钟 | 「{客户} 的视频《{标题}》发布流程卡住超过 30 分钟，可能中途被系统中断」 | 同上 in_doubt 的 ①–④（点「重新核对」会先把卡住的状态转成待核对再查） | 卡片深链 |
| `content_reel_first_comment_failed` | `first_comment.state in (failed, manual_required)` | 「{客户} 的 Reel《{标题}》已经公开了，但带报名链接的第一条评论没发出去——看到视频的人找不到链接」 | ①打开链接（Reel 本身）；②用 {page_name} 主页身份（右上角切换身份）在这条 Reel 下发评论，内容整段复制：`{first_comment.text}`；③回到卡片点「首评已手动发了」，待办消失。若原因是授权缺评论权限，想以后自动发：客户设置 →「连接 Meta」重新授权并保留全部勾选 | Reel permalink（已补全绝对网址） |
| `content_reel_measurement_not_started` | `state='published'` 超过 30 分钟，`followup.published_event_ids` 为空，且补发对账已跑过至少 2 轮 | 「{客户} 的 Reel《{标题}》已公开，但成绩回收没有启动——4 小时和 3 天后的点赞、评论不会被记下来」 | ①打开卡片点「重新启动成绩回收」（重发跟进事件，id 固定，重复点也只算一次）；②10 分钟后刷新，卡片显示「成绩回收中」即完成 | 卡片深链 |

同一 `content_post_id + kind` 一天只出一条；状态变了（被核对/被重新授权/首评已确认）自动消失——不重复 #1692 第 6 条「处理完也天天出现」的坑。

---

## 8. CTS 现成 5 条成片的挂载与发布路径

文件：Supabase Storage `content-factory` bucket `cts-reels/goldenchina-ads-20260908-v2/{gc_grandtour, gc_beijing, gc_xian, gc_shanghai, gc_food}.mp4`（make_promo 渲的，不在 `content_posts` 里）。

### 8.1 走同一条发布出口，不开旁路

1. **建卡片**：看板顶部新增「用已有成片新建」（新路由 `import-video`，body `{ title, offer_key? }`）。它**只做一件事**：插入一行 `content_posts`（`status='approved'`、`format='reel'`、`ratio='9:16'`、`platforms=['facebook']`、`route='route_a'`、`source='manual_import'`，`offer_key` 写进快照），**不排渲染、不挂片**。
   - 为什么不从 draft 建再点确认：CTS 若是 `render.engine='creatomate'`，确认会立即排一次 Creatomate 渲染并花钱（F14），而且没有逐字稿会直接失败、产生一条假待办。
   - 为什么不直接写库：必须留下「谁建的」鉴权轨迹（`role='admin'`），且不许 agent 直写生产库冒充 UI（PM 要求）。
2. **挂片**：卡片进「备料」列 → 用**现成的**「粘视频链接」（`video/route.ts` 的 `link` 动作，F13）粘该文件的 Storage 公开地址 → 逐跳探活通过 → 卡片进「出片」列。`uploaded` 动作不适用（路径格式固定为 `<client>/final/<post>/…`，要重新上传一遍）。
3. **授权发布**：与 Creatomate 成片完全相同的抽屉表单（§4），`render_job_id = null`。

操作者：FDE/PM 在后台点；或由 agent 用 PM 的登录态操作浏览器——仍然走同一套鉴权和记录，**不直写库**。

### 8.2 每条人审前的核对（授权表单强制，不是建议）

官网团页 `https://www.ctstours.co.nz/tours/china/discovery/golden-china` 2026-09-15 抓取核实：团名 *China Discovery — Golden China*、**12 Days**、**From NZD $4,999 per person**（另 NZD $690 单人房差）、出发 **16 November 2026 – 27 November 2026**、线路 Auckland → Shanghai → Beijing → Xi'an → Shanghai → Auckland。

| 文件 | 建议标题 | 建议落地页（按 memory「素材讲一个团 → 团页；泛讲/多团/钩子与团不符 → 列表页」） | 人审前必须补的证据 |
|---|---|---|---|
| gc_grandtour | Golden China 12 天总览 | 团页 | 分镜自检表（9 宫格）：每镜城市是否属于上面四城 |
| gc_beijing | 北京篇 | 团页（北京在该团线路内）——**前提**：片尾卖的是 Golden China 且画面全是北京 | 同上；若混入非线路城市 → 改列表页 |
| gc_xian | 西安篇 | 同上 | 同上 |
| gc_shanghai | 上海篇 | 同上 | 同上 |
| gc_food | 美食篇 | **待定**：食物画面无法逐镜证明属于这四城时 → 列表页 `https://www.ctstours.co.nz/china-tours` | 逐镜核对食物来源；证明不了一律按列表页 |

- 价格句必须带「from」（官网原文是 From NZD $4,999），正文/首评写成「$4,999」不带 from 视为「未证实」，按钮禁用。
- 目标受众是主流英语系新西兰人，文案 NZ 英语（memory `project-cts-target-customer-mainstream-nz`）。
- `utm_content` 建议 `gc_grandtour_reel` / `gc_beijing_reel` / …；`utm_campaign` 由 FDE 在 `publish_rules.utm.campaign` 配。
- 这 5 条原是「广告素材」批次（目录名 `-ads-`），当自然 Reel 发是 PM 本次需求本身，不另问。

---

## 9. 范围外（登记，不在本期做；实现 PR 合并时写进 ROADMAP 待认领，不在本分支改 ROADMAP）

1. Tune 读 Reel 回执（`social-post-cohort.ts:81`、`tune-suggestions/route.ts:62` 仍写死 `daily_plan`）；含首评对 comments 口径的扣减。
2. 广告归因 `creative-link.ts` 认 content_post 来源的 Reel（v2 事件没有 `work_order_id`，现有归因不会挂上）。
3. 审片记理由、打回重做流程（本期打回沿用现有 `reject`，只加 CAS）。
4. Instagram。
5. 排期发布（本期只有「现在发」）。
6. 撤回 / 删帖按钮（本期只支持「核对后标记 FB 上没有」再重新授权）。
7. LLM 起草正文与首评。
8. 讲课片线「`sending` 超 20 分钟自动重发」（`lecture-publish.ts:258-260`）——**A 级 backlog**，与本设计的「绝不自动重发」相冲突。
9. 工单线 `writeThreeBooks` 的 `vendor` 写死 `oztop_facebook`（F4）。
10. 工单线 `in_doubt`（`interrupted_verify_manual`）只 `console.error`、不进今日待办。
11. `creatomate_render_failed` 待办的 how 不可执行（F20）。
12. 自动建广告（`me_ad_launch`）消费 v2 事件。

---

## 10. 测试计划与上线步骤

### 10.1 测试（A 级）

**假 Graph 必须照真实返回形状**：实现前先用 CTS 页 token 做一组**只读**探针并把原始返回存进 `__fixtures__`（去 token）：`GET /<page>/video_reels?fields=id,description,permalink_url,updated_time`、`GET /<已公开 video_id 2259550698170048>?fields=id,status,permalink_url,published`、`GET /<page>_<video>/comments?fields=from,message`、一个不存在的 video_id（拿真实 100/33 错误体）。**写接口（start/rupload/finish/comments POST）的形状只能来自已有生产代码的解析路径与首条 DRAFT 实测**，fixture 注明来源；首评 POST 的真实错误体在 §10.3 首发时补录。

单元 / 集成（fake supabase 按表建模，不按调用顺序）：
- 状态机：每条合法迁移 + 每条非法迁移被拒；CAS 落空（`updated_at` 变了）→ 不调 Graph。
- 授权：缺记录 / 版本不认识 / hash 不符 / 有一句无来源 / 红线命中 / 视频指纹变 / 页名不符 → 各自 `preflight_failed` + 对应原因码，Graph 写接口调用次数 = 0。
- `client-viewer` 调授权 → 403；跨客户 `postId` → 404。
- DRAFT 阀：`mode_requested × env` 四种组合，只有 live×true 发 PUBLISHED。
- 上传中途失败：`start` 前失败 → `preflight_failed`；`onStarted` 之后 rupload / finish 抛错 → `in_doubt`，**且断言函数没有第二次调 start**；`onFailure` 把 `uploading` 改 `in_doubt`。
- 重复投递同一授权事件 → start 只调一次。重新授权（新 id）→ 新事件不被旧 id 去重。换片后重新授权 → `findExisting` 用新 tag，不认旧草稿。
- 草稿转正：不调 start/rupload，只调 finish(PUBLISHED)，video_id 不变，发布信号只发一次。
- 核对函数：公开 / 草稿 / 100+33 / 其他 100 / 190 → 各自状态。
- 跟进函数：`flywheel_actions` 已存在 → 不重复插；插失败 → 抛出且不发发布信号；重跑两次 → 事件 id 相同。
- 测量适配器：v1 事件全部既有测试原样通过；v2 事件幂等键为 `factory-content-reel:<post>:<video>`；同一帖子两条 `factory_reel_publish`（不同 video）时 v2 重绑只命中对应 video；v2 缺 `content_post_id` → `invalid_payload`。
- 首评：已存在自家带标记评论 → 不发；190 / #10 / 100 非 33 / 网络各原因码；失败不触碰帖子状态。
- 待办：五种 kind 各自判据、去重、状态变化后消失、读库失败抛出、每条 href 为绝对网址且 how 中出现的按钮名与 UI 文案逐字一致（测试直接 import UI 文案常量）。
- 看板 PATCH：`reject` 对 `published` / 进行中状态 → 409；`schedule` 只从 `approved`。
- Inngest 配置：测试读 `createFunction` 实际保存的 opts，断言发布与首评函数 `retries === 0`、跟进函数 `retries === 3` 且有 `onFailure`、`concurrency.key` 为 `event.data.client_id` limit 1（memory：注释写了≠配置真加了）。
- `cloudFunctions` 登记数 +4，命名前缀 `cloud-`；`UNSCHEDULED_CRON_ROUTES` 登记 4 个 job_name，registry 测试通过。
- 抽出的 `shared.ts` 之后 `publish-worker.test.ts` 与 `reel-published-emit.test.ts` 零改动全绿（证明工单线行为不变）。

**关键 mutation 清单**（冻结 head 上跑一次，每条改坏必须有测试红；探针先断言锚点命中，zsh 下用数组不用未拆分变量）：
1. 删掉授权 CAS 的 `updated_at` 条件；
2. 删掉 `status='approved'` 首次授权条件；
3. `idempotencyTag` 改成 `content_post_id`；
4. 发布事件 id 去掉 `authorization_id`；
5. v2 测量幂等键去掉 `video_id`；
6. `rebindContentReelAction` 去掉 `video_id` 过滤；
7. 发布函数 `retries` 改成 1；
8. `in_doubt` 分支改成重新上传；
9. DRAFT 阀改成只看 env 或只看 `mode_requested`；
10. hash 校验改成恒真；
11. `sentence_sources` 覆盖检查删掉；
12. 跟进函数 `flywheel_actions` 失败时继续发信号；
13. 首评查重步骤删掉；
14. 待办查询读失败返回 `[]`；
15. `role === 'admin'` 检查删掉；
16. 看板 `reject` 的 CAS 删掉。

基线口径：`npm run type-check` 与 `npm test` 在 main 上本就有红（memory `project-typecheck-baseline-red`），只报本 PR 触碰文件的交集；`npm run build` 必须过。

### 10.2 审查

设计阶段：子牙（架构）+ 魏征（挑刺）审本文件 → 修订 v2 → 才开始写代码。实施完：子牙 + 魏征再审一轮；授权与跨客户边界涉及鉴权，**狄仁杰**在实施后补一刀攻击验证（伪造授权事件、跨客户 postId、client-viewer 授权、篡改快照 hash）。review 轮次按 #964（A 级最多两轮）。

### 10.3 上线步骤（每个不可逆动作都要 PM 在对话里显式 go）

0. **只读核实**（实现前）：
   - `FACTORY_PUBLISH_LIVE` 现状：查 `cron_run_logs` 里 `job_name='factory-publish-worker'` 最近一条的 `summary->>'live'`（该 cron 每轮都把 env 值写进 summary，`route.ts:56`），不去 Render 后台翻；
   - CTS `factory_config.publish_target`、`render.engine`、`verified_cta.url`、`offers` 里有无 `landing_url`、`clients.facebook_page_id` 是否等于 `publish_target.page_id`（测量隔离检查读前者，F7/`daily-plan-post-measurement.ts:93-108`）；
   - `content_posts_updated_at` 触发器函数体（§3.2）；
   - CTS `platform_oauth_connections.scopes` 与到期日（memory 记 2026-11-02 到期）。
1. PR 合并（PM `go merge`）→ Render 部署 → **等部署 Live 后**再 `curl -sS -X PUT https://app.magicengine.com.au/api/inngest`，必须同时满足 `modified:true` 且 `GET /api/inngest` 的 `function_count` = 部署前 + 4（不含 onFailure 偏移的口径以部署前实测为准）；不等就再 PUT（memory `feedback-inngest-new-fn-needs-manual-resync`）。
2. 设置页给 CTS 填 `publish_rules`（FDE 在 UI 填，不直写库）。
3. 用 §8 流程建 `gc_grandtour` 卡片、挂片、授权，**方式选草稿** → 验：CTS 主页后台出现草稿、抽屉显示「草稿在后台」、`cron_run_logs` 有回执、`no_publish=true`、**测量与首评都没有被触发**。
4. PM 在 Meta 后台看草稿，确认格式无误后在对话里 `go live`。若 env 当前不是 `true`：PM 显式同意后才在 Render 设置（它同时影响工单线和讲课片线，必须先确认这两条线当前没有待发的 approved 工单/请求——只读查 `content_work_orders status in (approved, publish_failed)` 与讲课片 `lecture_publish_request` 非空）。
5. 抽屉点「把草稿正式发出」（`authorize_promote`，方式 live）→ 验：主页上公开、`video_id` 与草稿相同、`content_posts.status='published'`、`flywheel_actions` 一行 `factory_reel_publish` + 一行 `social.publish_post`（`idempotency_key=factory-content-reel:<post>:<video>`）、Inngest 有两条 `daily_plan.post.measure_due`；首评：若 `manual_required` → 今日待办出现且照 how 能做完。
6. 建日历提醒（hello@magicengine.cloud，Pacific/Auckland）：首发 +4 小时后的上午 9 点「查一下 Golden China 首条 Reel 的 4 小时成绩收回来没有」、+3 天上午 9 点「查 3 天成绩」；描述写清查 `social_post_measurement_receipts` 两个窗口各一行、reactions/comments 有数、shares 为 `omitted_unverified` 属正常、没有行时第一步看今日待办 `content_reel_measurement_not_started`。
7. 首条跑满 T+72 且无待办残留后，其余 4 条按同流程直接选 live（每条仍需人授权，逐条对官网）。

---

## 11. Reuse Statement

- **复用了什么已有平台能力**：`facebookReelAdapter.publish/findExisting`、`promoteReelToPublished`、`assertBrandMatches` / `resolveTarget` 防误发、`scanRedlineHits` 红线闸、`validateVideoUrl`、三本账写法、`normalisePermalink` 与 `me/factory.reel.published` 契约、`factoryReelMeasurementAdapter` 全部测量接线（`registerReelPublishAction`、`reelMeasureAt`、fan-out、`daily_plan.post.measure_due` 消费者与回执表零改动）、`content_posts` 与 `generation_context_snapshot` 有边界子键约定、`video/route.ts` 的 `link` 挂片、`requireDashboardClientAccess`、`cron_run_logs` 回执范式与 `UNSCHEDULED_CRON_ROUTES`、`factory-publish-worker` cron 的补发对账位、`loadManualItems` 今日待办、`FactoryConfigPanel` 设置页、`encodeIdemTag` 零宽标记（首评查重）。
- **真正 platform-shared 的新增**：content_post → Reel 授权发布状态机与授权记录、首评 CTA/UTM 拼装（参数全来自配置）、`postPageComment`（L3 Meta Connector 小扩展）、测量事件 v2 分支、五种今日待办、「用已有成片新建」卡片。
- **industry-specific**：无。落地页「单团 → 团页 / 泛讲 → 列表页」是 CTS 的规则，以两个配置字段（`offers[].landing_url`、`verified_cta.url`）表达，不进代码。
- **client-specific**：CTS 的 `publish_rules`（CTA 放首评、UTM 各值、引导句）、`offers.golden_china.landing_url`、5 条成片的标题/落地页/逐句来源；全部是配置或内容行。
- **客户事实有没有进 shared runtime**：没有。换 Oztop（建材、另一主页、可能 CTA 放正文）或悉尼地产客户：只改 `publish_target` / `publish_rules` / `verified_cta`，共享代码不改。唯一共享默认是「Facebook 自然 Reel 的正文链接不可点」这类**平台事实**，它只体现为 `cta_placement` 的校验，不是默认值。
- **学习沉淀**：建议补 memory——①「content_posts 没有发布中状态，要做原子认领只能用 `updated_at` 乐观锁或加表」；②「以主页身份发评论要 `pages_manage_engagement`，CTS 现有授权没有」（首发实测后写，未实测前不写成事实）。均为全局 reference 类，不含客户私有事实。
- **tier-gate 对账行**：决策时判定 = 既有社媒支柱「发布」能力延伸 + L3 Meta Connector 复用，不新增能力线、不登记候选；本设计落点一致——没有新增 `src/lib/<新领域>/` 能力目录（`content-reel/` 挂在既有 `src/lib/factory/` 下），Meta 侧只在既有 `src/lib/meta/` 加一个评论函数。

---

## 12. 未证实假设（实现前或首发时逐条验证）

| # | 假设 | 验证方式 |
|---|---|---|
| U1 | 生产 `content_posts_updated_at` 触发器存在且每次 UPDATE 刷新 `updated_at` | 只读查 `pg_trigger` + 函数体；不成立 → §3.6 |
| U2 | 以主页身份 POST `/<page_id>_<video_id>/comments` 对 Reel 有效 | 首条 live 发布时实测；失败即走 manual 待办 |
| U3 | 发主页评论需要 `pages_manage_engagement`，CTS 当前没有 | 查 `platform_oauth_connections.scopes`（只读）+ U2 实测错误体 |
| U4 | Video 节点 `status` / `published` 字段能区分草稿与公开 | 只读探针（已公开的 2259550698170048） |
| U5 | CTS `render.engine='creatomate'`，故不能从 draft 建卡片再确认 | 只读查 `clients.factory_config` |
| U6 | `safeProbeRemoteFile` 接受 Supabase Storage 公开地址、对几十 MB 文件 HEAD 正常 | 本地对其中一条 mp4 跑一次探活（只读） |
| U7 | `clients.facebook_page_id` = `publish_target.page_id` = 1616575215312482（否则测量隔离检查会拒） | 只读查库 |
| U8 | `FACTORY_PUBLISH_LIVE` 当前值（首条 Reel 2026-09-07 已公开，可能已是 true） | §10.3 第 0 步 |
| U9 | 看板支持 `?post=<id>` 深链打开抽屉 | 读 `content-factory/page.tsx`；不支持则同 PR 加 |
| U10 | 5 条 mp4 片尾写的是「From NZD $4,999」而不是「$4,999」，画面城市都在 Golden China 线路内 | 分镜自检表逐镜核对 |
| U11 | Inngest `step.sleep` 最长 15 分钟级别、单 run 总时长在套餐上限内 | 本设计最长等待约 20 分钟，远低于 #1692 第 7 条担心的量级，实现时查一次套餐文档 |
| U12 | CTS Meta 授权 2026-11-02 到期仍未续 | 只读查；到期前的续期提醒不在本期，但待办 `no_page_token` 会兜住 |
