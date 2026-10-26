# Creatomate / 现成成片 → 人工授权 → 原生发 Facebook Reel → 人工首评 + 只读核验 → T+4/T+72 成绩回收 · spec v2.1

> **2026-09-15 补记（随 PR-A 提交，不改设计结论）**：① 首评权限事实已核实，见 §1.1 P3 与 §6.5；② CTS 主页 token 永不过期，原「11 月 2 日到期」表述作废；③ PR-A 数据层实现与本文的对齐差异见 §15。

> 起草：Claude Code · 2026-09-15 · 状态：**设计稿 v2.1（设计定稿，可进入实现），未写任何业务代码 / migration / 路由 / Inngest 函数**
> 取代：[`2026-09-15-creatomate-reel-publish-spec-v1.md`](./2026-09-15-creatomate-reel-publish-spec-v1.md)（v1 保留作审查记录）
> 基线：`origin/main` = `f9c8f3aa5dad51ff5f593edce329833e260a91d3`（2026-09-15 01:45 NZST 拉取，含 #1686）
> 审查沿革：v1 → 子牙 11 条阻断 + 魏征 M1–M13 → 协调方裁决 D1–D16 → 生产只读探针 X1/X2/X4 → v2 → **第二轮（最后一轮）两审 → 协调方合并裁决 12 项 → 本 v2.1**。不开第三轮。对照见 §13
> 风险级别：**A 级**（不可逆对外发布 + 状态机/幂等 + migration + SECURITY DEFINER RPC + 鉴权边界）
> Tier：既有社媒支柱「发布」能力延伸 + L3 Meta Connector（`facebookReelAdapter`）复用；不新增能力线、不登记候选（§11）
> IMPACT：**Act**（发 Reel）→ **Check**（T+4 / T+72）。Tune、自动建广告本期不接（§9）
> 实现：拆 3 个 PR（§14）

## v2.1 变更摘要（相对 v2）

1. **状态机补出口**：新增 `cancelled`（领取前撤销授权）、`removed_externally`（已公开后被外部删除）；新增员工动作「放弃这次上传」（仅对未公开的 `in_doubt`，先删后两次缺席确认）与「放弃这条内容」（删草稿后卡片改 `rejected`）；`not_on_facebook` 在有 `video_id` 时必须有成功删除记录；`video_status=error` 映射为 `failed`；catch 里迁移被抢时重读真实状态；草稿上传读回已公开 → `in_doubt` + 告警；`not_on_facebook → published` 允许（核对发现其实公开）。§3.2、§3.4
2. **单步时长写死**：strict 模式 start/finish 各 60 秒、rupload 15 分钟；每次 Graph 写前刷新 `last_step_started_at`；`not_on_facebook` 时间下限 30 分钟写进 RPC SQL；finish 前 `beforeFinish` 回调复核状态。§2.1、§3.4
3. **自动删草稿收紧**：删前 GET 必须明确读到未公开；首条草稿字段存 fixture 前自动删草稿默认关，只出「草稿待删」待办。§4.5
4. **人工确认已公开收紧**：必须粘贴 Reel 网址且编号等于记录；`human_confirmed` 不触发删草稿、T+4 复核失败退回 `in_doubt`、不计入 30 天同哈希。§3.4、§4.5
5. **跟进函数**：按 `authorization_id` 串行；内容 Reel 独立记账 helper，不复用工单线 `writeThreeBooks`；`followup`/`trigger_event_ids`/`restart_seq` 走原子 RPC。§5.3
6. **旧入口防护补到 7 个**，外加 `brand-aliases` 写入收紧为内部员工；`content_reel_authorize` 拒绝已发布过的内容。§3.5
7. **待办 how 不教人绕过防误发**：`brand_mismatch` 走品牌别名（内部员工写），不改品牌名；`page_binding_mismatch` 以员工绑定为准；成绩回收两次重启仍失败转系统告警。§7
8. **权限与开关**：授权与预览用精确管理员名单并排除共享邮箱；`publish_rules` 仅内部员工写；客户级开关改为独立列 + 原子 RPC + 审计表。§4.1、§4.4
9. **授权提交防重复 + 视频副本挪到异步「准备」阶段**（新增第 3 个 Inngest 函数，理由见 §2.1）。§4.2、§4.3
10. **回滚顺序**写全。§10.5
11. 小项：开关关闭选 live 记 `preflight_failed(live_switch_off)`；claimed 无视频编号超 5 分钟才可判没有；测量 trigger 上线验证方法；所有 Graph 调用在 `step.run` 内；首评核验先查视频本体再查组合编号并翻页；`import_source_url` 改独立列。
12. 30 天同哈希窗口列为 PM 业务口径待定项（先按 30 天）。
13. 单个视频 GET 返回 `published`/`status` 已由协调方证实，写入 §1.3、§2.1、§10.1、§12。
14. 新增 §14 实现拆分计划。

---

## 0. 一句话

内部员工（或 agent）先点「准备发布素材」→ 后台把视频复制到不可覆盖路径并算内容哈希 → 员工在出片抽屉审片（含九宫格分镜自检）、审正文、审首评、逐句标来源，**亲手点「授权发布」并输入主页名** → 数据库保证一条内容同时只有一次进行中的发布 → 发布函数拿副本原生上传成 Reel（默认草稿；全局急停开关 + 客户级开关 + 授权选公开，三者都为真才公开）→ 系统 GET 确认公开后落回执 → 跟进函数写账、发**独立的**内容 Reel 事件 → 测量登记 T+4/T+72 → 首评由人用主页身份粘贴锁定原文，点「已发」触发只读核验。所有卡点进 4 种今日待办，按钮真实存在；需要撤回的每个状态都有出口。

---

## 1. 事实基线

### 1.1 生产只读事实（协调方 2026-09-15 核实）

| # | 事实 |
|---|---|
| P1 | `content_posts` 有 `BEFORE UPDATE handle_updated_at()`（`now()`）与 `AFTER UPDATE OF status trg_sync_execution_item_on_post_published` |
| P2 | `FACTORY_PUBLISH_LIVE` 生产为 `false` |
| P3 | CTS 现存主页 token 无 `pages_manage_engagement`；`META_PAGE_SCOPES`（`src/lib/meta-oauth/client.ts:37-63`）当前不申请它。**2026-09-15 协调方核实**：生产 `FACEBOOK_APP_ID=1752513682785923` 在 Meta 后台 `pages_manage_engagement` 为「Standard access · 使用中」，**无需 Meta 审核**；另一分身的小 PR 把它加进 `META_PAGE_SCOPES`，上线后内部员工在 CTS 设置页重连即可获得 |
| P6 | CTS 主页 token `debug_token`：app_id 相同、`type=PAGE`、**`expires_at=0`（永不过期）**。`platform_oauth_connections.token_expiry` 列记的日期（此前 memory 写「11 月 2 日到期」）与真实 token 不符，真实 token 永不过期 |
| P4 | CTS `clients.facebook_page_id` 与 `factory_config.publish_target.page_id` 一致 |
| P5 | CTS `factory_config.render.engine = 'creatomate'` |

### 1.2 代码事实（v1 F1–F20 仍有效；以下为 v2/v2.1 新增或更正，均在 `origin/main` 核实）

| # | 事实 | 位置 |
|---|---|---|
| F3′ | **更正 v1**：讲课片线真发 = `publishRequest.live === true \|\| env`；全局 env 一开，所有讲课片请求都变真发；工单线同样全局受控 | `lecture-publish.ts:109`、`factory-publish-worker/route.ts:24` |
| F21 | `findExisting` 遇 Graph 报错 `return null` | `facebook-reel-adapter.ts:150` |
| F22 | start 与 finish 调同一路径 `/${pageId}/video_reels` | `facebook-reel-adapter.ts:95, 112` |
| F23 | `resolveToken` 回退全局 `META_SYSTEM_USER_TOKEN`；`assertBrandMatches` 品牌名或页名为空直接放行 | `facebook-reel-adapter.ts:40-77` |
| F24 | `promoteReelToPublished` 调 finish 不带 `description`；生产无转正成功证据 | `facebook-reel-adapter.ts:170-195` |
| F25 | `/api/posts/[id]` PATCH 允许改 `status`，付费档即可 | `src/app/api/posts/[id]/route.ts:60-81` |
| F26 | `/api/posts/batch` 的 `delete` / `updateStatus` 付费档可调 | `src/app/api/posts/batch/route.ts:44-73` |
| F27 | `[postId]` PATCH `confirm` 除 LinkedIn 外无状态条件；会新排 Creatomate 渲染；`finalizeSuccess` 无条件覆盖 `source_video_url` | `[postId]/route.ts:114-132, 178-191`、`factory-creatomate-render.ts:238` |
| F28 | `/api/publer/create-post` 只检查 `status==='approved'` | `src/app/api/publer/create-post/route.ts:52` |
| F29 | `guardGlobalAdmin` = `role==='admin' && !allowedClientId`（认域名匹配）；`isGlobalAdminEmail` 只认 `ADMIN_EMAILS` 精确名单、不认域名 | `src/lib/auth/require-admin.ts:65-80`、`src/lib/auth/whitelist.ts:14-30` |
| F30 | SECURITY DEFINER 惯例：`SET search_path = pg_catalog, pg_temp`；`REVOKE ALL … FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE … TO service_role` | `20260905123025_fix_post_measurement_search_path.sql`、`20260905000001_…:236-249` |
| F31 | 看板页不支持 `?post=<id>` 深链 | `content-factory/page.tsx` |
| F32 | `expect_brand` 无编辑入口；`master_briefs.brand_name` 在 Brief 面板可编辑；`clients.facebook_page_id` 由 FDE 专用绑定路由写 | `BriefEditor.tsx:86-87`、`api/clients/[id]/facebook-page/route.ts:1-17` |
| F33 | `clients.domain` 存在；其写入权限问题已进协调方安全 issue #1699 | `cross-client-audit.ts:142` |
| F34 | 读评论有 `pages_read_engagement` + `pages_read_user_content`，发评论权限不在清单 | `meta-oauth/client.ts:37-63` |
| F35 | `clients.brand_aliases text[]` 存在（`20260624010000_client_brand_aliases.sql:26`），设置页有 `BrandAliasesPanel`；**但写入路由 `api/clients/[id]/brand-aliases` 只用 `requireDashboardClientAccess`，客户本人可写** | `brand-aliases/route.ts:43, 71` |
| F36 | 另外 4 个会改 `content_posts.status` 或直接发帖的入口：`clients/[id]/production/[packageId]/schedule`（批量改 `approved`，`:67-74`）、`visual/batch-image`（改 `approved`，`:17, 85`，其跨客户越权见 #1699）、`publer/create-post`、`clients/[id]/content-posts/[postId]/publish` | 各路由文件 |

### 1.3 生产只读探针（协调方 2026-09-15，CTS 主页，页 token 只读 GET）

| # | 实测 | 设计约束 |
|---|---|---|
| X1 | `encodeIdemTag` 的 32 位 U+200B/U+200C 被 Facebook 剥掉，只剩 U+2063 锚点（9/06、9/01 两条工厂 Reel） | `findExisting` 永远匹配不上；工单线防线失效（#1697）。**v2.1 不以任何零宽标记作防重/核对依据** |
| X1′ | **单个视频 GET 已证实**：`GET /2259550698170048?fields=id,description,status,published,created_time,permalink_url` → `published: true`、`status.video_status: "ready"`、`status.uploading_phase` / `status.processing_phase` / `status.publishing_phase`（`publish_status: "published"`）、`status.copyright_check_status`、`permalink_url: "/reel/2259550698170048/"`（相对路径） | 「已公开」判定字段在单个视频 GET 上真实存在 |
| X2 | `video_reels` 列表项字段同上；列表里全是已公开 Reel，**无草稿样本** | 分类不依赖列表；草稿字段取值未证实 |
| X4 | 视频/照片本体已删与从未存在都返回 HTTP 400 `code 100 / error_subcode 33`；组合 id `<page>_<post>` 删除后返回 `code 10` | 100/33 分不出已删 / 从未存在 / 无权限；组合 id 不能判存在；code 10 当查询失败 |

---

## 2. 架构

### 2.1 Inngest 线 + 同步路由 + 独立表

- 不扩 publish-worker（理由同 v1 §2.1，两轮审均认可）。
- **Inngest 函数 3 个**：
  - `cloud-factory-content-reel-prepare`（`retries: 2`）：复制副本 + 流式算 sha256。**比 D14 的「2 个」多 1 个**：第二轮裁决第 9 项要求复制挪到异步准备阶段，以摆脱路由 300 秒上限；复制是可重试的幂等动作（目标路径按 copy_id 固定、`upsert:false` 冲突时校验已有文件哈希），与发布副作用分开。
  - `cloud-factory-content-reel-publish`（`retries: 0`，`concurrency: {key: 'event.data.client_id', limit: 1}`）。
  - `cloud-factory-content-reel-followup`（`retries: 3` + `onFailure`，`concurrency: {key: 'event.data.authorization_id', limit: 1}`）。
- 同步路由：预览、授权、撤销授权、核对、放弃这次上传、放弃这条内容、人工确认已公开、首评核验、删除草稿、重启成绩回收、重新发起发布。
- **所有 Graph 调用都在 Inngest `step.run` 内或同步路由内**，不在 step 之外的函数体里。
- 从 `publish-worker.ts` **只加 `export`、不搬家**：`resolveTarget`、`scanPublishCaption`、`validateVideoUrl`。**`writeThreeBooks` 不复用、一行不动**（§5.3）。
- 适配器只做加法（默认行为不变）：
  - `PublishTarget.strict?: true`：
    - 只用库存页 token，不回退 `META_SYSTEM_USER_TOKEN`；品牌名/页名为空抛 `brand_mismatch`；品牌比对同时认 `master_briefs.brand_name` 与 `clients.brand_aliases`（D12 + 第二轮第 7 项）；
    - 不往 description 追加零宽标记；
    - 超时：start `AbortSignal.timeout(60_000)`、rupload `AbortSignal.timeout(900_000)`、finish `AbortSignal.timeout(60_000)`、所有 GET `AbortSignal.timeout(10_000)`；
    - 新回调 `beforeWrite(phase: 'start'|'rupload'|'finish')`：每次 Graph 写之前调用，由调用方刷新 `last_step_started_at`；`phase==='finish'` 时调用方复核 `state='uploading' AND id=<本授权>`，不满足抛错 → 不调 finish。
  - **不使用 `findExisting`**（X1）。唯一可信源 = 数据库记录的 `video_id`。
  - `getReelObjectStatus(videoId, pageId)`：同一次调用先 `GET /<page_id>?fields=id`（主页可读性探针），再 `GET /<video_id>?fields=id,published,permalink_url,status`。返回：
    - `{kind:'exists', phase}`：
      - `published===true && status.publishing_phase.publish_status==='published' && status.video_status==='ready'` → `published`（X1′ 已证实字段）；
      - `status.video_status==='error'` → `failed`；
      - `status.video_status` 非 `ready` 且非 `error`，或 `uploading_phase`/`processing_phase` 未完成 → `processing`；
      - `published===false` 字段**真实存在** → `not_public`；
      - 字段缺失或组合不在上面 → `unknown`；
    - `{kind:'absent_confirmed_once'}`：本体 `100/33` **且** 主页探针成功；
    - `{kind:'error', code}`：主页探针失败、`code 10`、`code 190`、超时、网络、其他。
  - `deleteReelVideo(videoId)`：`DELETE /<video_id>`；返回成功或 `100/33` 都记为「删除成功」，其余为失败。
  - 所有存在性判断只用 `video_id` 本体，不用 `<page>_<video>`（X4）。
  - `promoteReelToPublished` 本期不调用（D4）。

### 2.2 组件清单

见 §14 的三个 PR 分拆，每个 PR 列出自己的文件。

---

## 3. 数据模型与状态机（D1 + 第二轮第 1、2、4、5、6、9 项）

### 3.1 表与列（全部在 PR-A migration）

```sql
-- ① 视频副本（准备阶段产物，不可改）
CREATE TABLE public.content_reel_video_copies (
  id                 uuid PRIMARY KEY,
  client_id          uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  content_post_id    uuid NOT NULL REFERENCES public.content_posts(id) ON DELETE RESTRICT,
  source_video_url   text NOT NULL,
  copy_path          text NOT NULL UNIQUE,          -- content-factory/<client>/authorized/<copy_id>.mp4
  sha256             text NULL,
  content_length     bigint NULL,
  status             text NOT NULL CHECK (status IN ('preparing','ready','failed')),
  error_code         text NULL,
  requested_by_user_id uuid NOT NULL,
  prepared_by        text NOT NULL CHECK (prepared_by IN ('human','agent')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- ② 发布尝试（回执本体）
CREATE TABLE public.content_reel_publish_attempts (
  id                        uuid PRIMARY KEY,                 -- = authorization_id（预览时生成）
  client_id                 uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  content_post_id           uuid NOT NULL REFERENCES public.content_posts(id) ON DELETE RESTRICT,
  video_copy_id             uuid NOT NULL REFERENCES public.content_reel_video_copies(id) ON DELETE RESTRICT,
  render_job_id             uuid NULL,
  mode_requested            text NOT NULL CHECK (mode_requested IN ('draft','live')),
  state                     text NOT NULL CHECK (state IN (
                              'authorized','claimed','uploading','in_doubt',              -- 进行中
                              'cancelled','preflight_failed','not_on_facebook',           -- 终态（可再授权）
                              'draft_published','draft_deleted',                          -- 草稿
                              'published','removed_externally')),                         -- 公开
  form_sha256               text NOT NULL,                    -- 授权表单内容哈希，重复提交比对
  authorized_via            text NOT NULL CHECK (authorized_via IN ('ui_click','chat_go')),
  authorized_by_user_id     uuid NOT NULL,
  authorized_by_email       text NOT NULL,
  prepared_by               text NOT NULL CHECK (prepared_by IN ('human','agent')),
  authorization             jsonb NOT NULL,                   -- §4.2，RPC 不提供修改
  video_sha256              text NOT NULL,
  page_id                   text NOT NULL,
  video_id                  text NULL,                        -- 写入后不可改
  video_state               text NULL CHECK (video_state IN ('DRAFT','PUBLISHED')),
  permalink                 text NULL,                        -- 绝对网址
  published_at              timestamptz NULL,
  publish_confirmation      text NULL CHECK (publish_confirmation IN ('graph_get','human_confirmed')),
  publish_confirmed_by_user_id uuid NULL,
  publish_verified_at       timestamptz NULL,                 -- GET 或 T+4 复核读到公开的时间
  env_live_at_publish       boolean NULL,
  rules_live_at_publish     boolean NULL,
  error_code                text NULL,
  error_detail              text NULL,
  alert_code                text NULL,                        -- 如 draft_read_back_public / not_on_facebook_found_public
  last_step_started_at      timestamptz NULL,
  video_deleted_at          timestamptz NULL,                 -- 我方 DELETE 成功（含 100/33）的时间
  absence_first_confirmed_at timestamptz NULL,
  trigger_event_ids         text[] NOT NULL DEFAULT '{}',
  restart_seq               integer NOT NULL DEFAULT 0,
  first_comment_state       text NOT NULL DEFAULT 'pending'
                              CHECK (first_comment_state IN ('pending','verified','not_applicable')),
  first_comment_verified_at timestamptz NULL,
  first_comment_verification_basis text NULL CHECK (first_comment_verification_basis IN ('from_and_url','url_only')),
  followup                  jsonb NOT NULL DEFAULT '{}',
  provider_impact           jsonb NOT NULL DEFAULT '{}',
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  finished_at               timestamptz NULL
);

CREATE UNIQUE INDEX content_reel_publish_attempts_one_active
  ON public.content_reel_publish_attempts (content_post_id)
  WHERE state IN ('authorized','claimed','uploading','in_doubt');
CREATE UNIQUE INDEX content_reel_publish_attempts_video
  ON public.content_reel_publish_attempts (video_id) WHERE video_id IS NOT NULL;
CREATE INDEX content_reel_publish_attempts_hash  ON public.content_reel_publish_attempts (client_id, video_sha256, created_at DESC);
CREATE INDEX content_reel_publish_attempts_state ON public.content_reel_publish_attempts (state, updated_at);

-- ③ 客户级发布开关（独立列 + 审计表，第二轮第 8 项）
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS content_reel_live_enabled boolean NOT NULL DEFAULT false;
CREATE TABLE public.content_reel_live_switch_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  old_value boolean NOT NULL, new_value boolean NOT NULL,
  changed_by_user_id uuid NOT NULL, changed_by_email text NOT NULL, reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ④ 导入幂等用独立列（第二轮第 11 项）
ALTER TABLE public.content_posts ADD COLUMN IF NOT EXISTS import_source_url text NULL;
CREATE UNIQUE INDEX IF NOT EXISTS content_posts_import_source_url
  ON public.content_posts (client_id, import_source_url) WHERE import_source_url IS NOT NULL;

-- 三张新表：ENABLE ROW LEVEL SECURITY + CREATE POLICY "service_role_full" … FOR ALL TO service_role USING (true) WITH CHECK (true)
```

`updated_at` 触发器复用 `handle_updated_at()`。`content_posts.generation_context_snapshot` 不存任何发布状态。

### 3.2 RPC（全部 `SECURITY DEFINER`、`SET search_path = pg_catalog, pg_temp`、函数体 `public.` 全限定、`REVOKE ALL … FROM PUBLIC, anon, authenticated`、`GRANT EXECUTE … TO service_role`）

| RPC | 单事务内做什么 |
|---|---|
| `content_reel_video_copy_start(p jsonb)` / `…_finish(p_id, p_status, p_sha256, p_len, p_error)` | 插入 `preparing` / 置 `ready`/`failed`（只允许 `preparing` 出发，`ready` 不可再改） |
| `content_reel_authorize(p jsonb)` | ① `SELECT … content_posts FOR UPDATE`；② 同 `id` 的 attempt 已存在：`form_sha256` 相同 → 返回 `{ok:true, duplicate:true, state}`，不同 → `{ok:false, code:'authorization_id_reused'}`；③ 帖子 `status='approved'` 且 `source_video_url` 等于副本记录；④ 副本 `status='ready'`、属于该帖、`sha256` 等于表单；⑤ 无进行中渲染任务；⑥ 该帖不存在 `published` / `removed_externally` attempt → 否则 `post_already_published`（要再发请新建卡片）；⑦ 同客户近 **30 天**（PM 待定口径，§9 业务项）无同 `video_sha256` 的进行中记录，也无 `state='published' AND (publish_confirmation='graph_get' OR publish_verified_at IS NOT NULL)` 的记录（未经证实的 `human_confirmed` 不计）；⑧ 插入 `authorized`（部分唯一索引兜底）；⑨ 帖子 `approved → scheduled` |
| `content_reel_transition(p_id, p_from text[], p_to, p_patch jsonb)` | `SELECT … FOR UPDATE` 后：当前状态不在 `p_from` → `{ok:false, code:'transition_lost', current_state}`；`(state,p_to)` 不在 §3.3 迁移表 → `RAISE EXCEPTION`；`p_patch` 白名单列；`video_id` 已有不同值 → 异常；`p_to IN ('cancelled','preflight_failed','not_on_facebook','draft_published')` 且无其他进行中 attempt → 同事务帖子 `scheduled → approved`；**`p_to='not_on_facebook'` 的 SQL 条件**：`video_id IS NULL` 时要求 `state='claimed' AND last_step_started_at <= now() - interval '5 minutes'`（start 超时 60 秒 + 余量），或来源是 `preflight`；`video_id IS NOT NULL` 时要求 `video_deleted_at IS NOT NULL` **且** `absence_first_confirmed_at <= now() - interval '10 minutes'` **且** `last_step_started_at <= now() - interval '30 minutes'`（= start 60 秒 + rupload 15 分钟 + finish 60 秒 = 17 分钟，再加 13 分钟余量；数值写死在函数体并注释来源）；`p_to='removed_externally'` 同样要求两次缺席的时间条件 |
| `content_reel_mark_post_published(p_id)` | attempt `state='published'` 时帖子 `status → published` 并写 `published_at`（与回执分两次调用） |
| `content_reel_followup_patch(p_id, p_key, p_value jsonb)` / `content_reel_append_event_id(p_id, p_event_id)` / `content_reel_next_restart_seq(p_id) RETURNS int` | `jsonb_set` 原子更新单个键 / `array_append` / `restart_seq = restart_seq + 1 RETURNING`（第二轮第 5 项） |
| `content_reel_abandon_post(p_post_id, p_user_id)` | 该帖无进行中 attempt、无 `published` attempt、所有 `draft_published` 已 `draft_deleted` → 帖子改 `rejected`；否则返回原因码 |
| `set_content_reel_live_enabled(p_client_id, p_expected_old, p_new, p_user_id, p_email, p_reason)` | `SELECT … clients FOR UPDATE`；当前值 ≠ 期望旧值 → `{ok:false, code:'stale'}`；更新列 + 插审计行 |

### 3.3 迁移表

| 从 | 可到 | 触发者 |
|---|---|---|
| `authorized` | `claimed` | 发布函数（领取） |
| `authorized` | `cancelled` | 员工「撤销授权」（与领取同一行锁互斥） |
| `authorized` | `preflight_failed` | 发布函数（授权记录校验失败 / `live_switch_off`） |
| `claimed` | `uploading`（带 `video_id`） | 发布函数 `onStarted` |
| `claimed` | `preflight_failed` | 发布函数（预检失败 / 未拿到 video_id 前失败） |
| `claimed`（无 video_id，超 5 分钟） | `not_on_facebook` | 核对路由 |
| `uploading` | `published` / `draft_published` / `in_doubt` | 发布函数 |
| `uploading` / `in_doubt` | `published` / `draft_published` / `in_doubt` | 核对路由 |
| `in_doubt` | `published`（`human_confirmed`） | 员工「我已在主页上看到这条公开」 |
| `in_doubt`（已删 + 两次缺席） | `not_on_facebook` | 员工「放弃这次上传」完成后的第二次核对 |
| `published` | `removed_externally` | 核对路由（两次缺席） |
| `published`（`human_confirmed`） | `in_doubt` | 跟进 T+4 复核读不到公开 / 核对 GET 非公开 |
| `not_on_facebook` | `published` | 核对路由读到公开（写 `alert_code='not_on_facebook_found_public'`） |
| `draft_published` | `draft_deleted` | 删除草稿流程（删前确认未公开 + 删后两次缺席） |
| 其余 | 拒绝（终态不回退） | |

### 3.4 防重复发帖细节

1. **领取**：`transition(['authorized'] → 'claimed')`；`transition_lost` → 函数结束，不碰 Graph。
2. **授权记录校验**（§4.2）失败 → `preflight_failed`。
3. **开关**：`mode_requested='live'` 但 `CONTENT_REEL_PUBLISH_LIVE!=='true'` 或 `clients.content_reel_live_enabled=false` → `preflight_failed(live_switch_off)`，**不悄悄改成草稿**。
4. **预检**（碰 Graph 写接口之前）：
   - strict 取 token 与页名；品牌名与别名都不匹配或为空 → `brand_mismatch`；
   - `publish_target.page_id === clients.facebook_page_id`，否则 `page_binding_mismatch`；
   - 帖子 `source_video_url` 仍等于副本记录的 `source_video_url`，否则 `video_changed_since_authorization`；
   - 副本 HEAD：`content-length` 与副本记录一致、`content-type` 为 `video/*`；**重算 sha256**（流式读副本，与 `video_sha256` 比对）不符 → `video_copy_hash_mismatch`；
   - 红线再扫锁定正文与首评；
   - 历史视频检查：该帖所有历史 attempt 非空 `video_id` 逐个 `getReelObjectStatus`：`published`/`processing`/`unknown` → `prior_video_live`；`error` → `prior_video_unverifiable`；`not_public`/`failed` 仅当那条是 `draft_published` 时允许；`absent_confirmed_once` 仅当那条已是 `not_on_facebook`/`draft_deleted`/`removed_externally` 时允许；
   - 本 attempt 已有 `video_id` → `in_doubt(video_id_before_upload)`。
5. **上传**：`facebookReelAdapter.publish({ videoUrl: 副本公开地址, caption: 锁定正文, target:{…, strict:true}, draft: !live, onStarted, beforeWrite })`。
   - `beforeWrite('start'|'rupload')`：`transition(['claimed'|'uploading'] → 同状态, {last_step_started_at: now})`，失败抛错；
   - `onStarted(videoId)`：`transition(['claimed'] → 'uploading', {video_id, last_step_started_at})`，`transition_lost` 或数据库错误抛错，rupload 前中止；
   - `beforeWrite('finish')`：复核 `state='uploading' AND id=本授权` 并刷新时间，否则抛错，不调 finish（例如 `onFailure` 已把它改成 `in_doubt`、或员工已放弃这次上传）。
   - 为什么不需要 FB 侧标记：Reel 只有 finish 后才可能公开，finish 一定在 `video_id` 落库且状态复核之后。
6. **阶段判定只看两件事**：`onStarted` 是否成功执行、库里是否有 `video_id`。有 → `in_doubt`；无 → `preflight_failed(failed_before_upload)`。
7. **catch 与迁移被抢**：catch 中调 `transition` 得到 `transition_lost` 时，重读该行，按真实状态处理（已是 `in_doubt`/`published`/终态 → 不再改，只写运行记录），不盲目覆盖。`onFailure` 同理。
8. **确认与回执**：finish 返回后 `getReelObjectStatus`：
   - 公开上传：`published` → `published(graph_get)`，写 `publish_verified_at`；`processing` → `step.sleep` 2/5/10 分钟再查，仍 `processing` → `in_doubt(processing_timeout)`；`not_public`/`failed`/`unknown`/`absent`/`error` → `in_doubt`；
   - 草稿上传：`not_public` 或 `processing` 或 `unknown` 且非公开 → `draft_published`；**读到 `published` → `in_doubt` + `alert_code='draft_read_back_public'`（高优先级待办），随后按第 11 步删除该视频 + 两次缺席 → `not_on_facebook`，绝不进入 `published`**（数据库以 `mode_state_mismatch` 拒绝草稿请求进入 `published`）；`failed` → `in_doubt(video_failed)`；
   - **PR-C 转 `published` 时**：先读出当前行的 `absence_first_confirmed_at`，把它与本次 GET 结果一起比对（缺席证据之后又读到公开 = 异常，写 `alert_code`），不要依赖 RPC 无条件清空缺席值来掩盖这个矛盾（RPC 本期仍自动清空，PR-C 在调用前做比对）；
   - 回执写入有界重试 5 次（1/2/4/8/16 秒），仍失败 → 尝试 `in_doubt(receipt_write_lost)`；再失败留在 `uploading`，由「卡住」待办兜住。
9. **status→published**：回执成功后单独调 `content_reel_mark_post_published`，失败由跟进函数补做。
10. **缺席证据**（`not_on_facebook` / `removed_externally` / `draft_deleted` 共用）：
    - 只查 `video_id` 本体；每次必须「本体 100/33 且主页可读」才算一次缺席证据；
    - `code 10`/`190`/超时/网络 → 查询失败，不清零也不累加；
    - 第一次缺席记 `absence_first_confirmed_at`；两次之间任何一次 `exists` → 清零；
    - 满足 §3.2 SQL 时间条件的第二次缺席才迁移；
    - 残余风险：对本 token 视频级不可读而主页可读时可能误判，已用「删除成功记录 + 两次间隔 + 30 分钟无在跑写入」压到最低（U3）。
11. **放弃这次上传**（员工，仅 `in_doubt`）：`getReelObjectStatus`：
    - `published` → 拒绝，并按 `published` 迁移（**草稿请求读到公开时不迁移到 `published`**，而是继续本步骤：删除视频 + 两次缺席 → `not_on_facebook`）；`processing`/`unknown`/`error` → 拒绝（不能确认未公开）；已有删除记录的视频再读到公开，进入 `published` 必须带 `alert_code`（数据库强制）；
    - `not_public`（`published===false` 字段真实存在）或 `failed` 或 `absent_confirmed_once` → `transition(['in_doubt']→'in_doubt', {last_step_started_at})` → `deleteReelVideo` → 成功写 `video_deleted_at` → 提示「10 分钟后点重新核对」→ 第二次核对满足条件 → `not_on_facebook`（卡片回出片列，可再授权）。
    - 「容器未完成」按 `status.uploading_phase` 未完成识别，归入 `processing`；超过 30 分钟无写入的未完成容器视为 `failed` 允许放弃（X4′ 待首条样本证实，§12）。
12. **放弃这条内容**（员工）：该帖每条 `draft_published` 走删除草稿流程（§4.5）；全部 `draft_deleted` 后 `content_reel_abandon_post` 把卡片改 `rejected`；有 `published`/进行中 attempt → 拒绝并说明原因。待办判据排除 `rejected` 帖子。

### 3.5 旧入口防护（D9 + 第二轮第 6、7 项；在 PR-B）

| 入口 | 防护 |
|---|---|
| `[postId]` PATCH `confirm` | 只允许从 `draft/rejected`（写进 UPDATE 条件） |
| `[postId]` PATCH `reject` | 只允许从 `draft/approved`，且该帖无进行中或 `published`/`draft_published` attempt |
| `[postId]` PATCH `schedule` | **在 PR-C 上线时**才对配了 `publish_target` 的客户拒绝（PR-B 若先上线会让 CTS 现有「满意·去发布」没有替代入口） |
| `/api/posts/[id]` PATCH | body 含 `status` 且该帖有**进行中或 `published`** attempt → 409 |
| `/api/posts/batch` | `updateStatus`/`delete` 命中有进行中或 `published` attempt 的帖子 → 整批 409；删除另有外键 RESTRICT |
| `clients/[id]/production/[packageId]/schedule` | 命中同上帖子 → 409 |
| `visual/batch-image` | 同上 409；其跨客户越权由 #1699 修，本 PR 只加 409 并在代码注释链接 #1699 |
| `publer/create-post` | 同上 409 |
| `clients/[id]/content-posts/[postId]/publish` | 同上 409 |
| `clients/[id]/brand-aliases` PATCH | 写入改为内部员工（`guardGlobalAdmin` 判据）；读取不变。理由：预检把别名当防误发依据，客户可写就等于客户能放行发到别家主页（memory「客户可改的绑定=别处鉴权依据」）|
| `clients/[id]/factory-config` PATCH | （PR-C）`publish_rules` 整个对象仅内部员工可写；body 带 `content_reel_live_enabled` / `live_enabled` 一律 400 |

所有 409 检查读 attempt 表失败时 fail-closed 返回 503，不放行。

---

## 4. 授权（D6/D7/D8 + 第二轮第 8、9 项）

### 4.1 谁、在哪、怎么点

- **在哪**：出片列卡片抽屉，`?post=<id>` 深链直达。客户配了 `publish_target` 才出现发布区。
- **谁**：
  - **预览、授权**：`requireDashboardClientAccess(clientId)` 通过 **且** `isGlobalAdminEmail(email)`（只认 `ADMIN_EMAILS` 精确名单，不认域名）**且** `getUserPermissions(email).allowedClientId` 为空 **且** 邮箱不在共享邮箱名单（`SHARED_ADMIN_MAILBOXES` 常量，首项 `hello@magicengine.cloud`，放 `src/lib/auth/`，属 ME 内部平台常量，不是客户事实）。
  - **其余 action**（准备、撤销、核对、放弃、人工确认、首评核验、删草稿、重启、重新发起、import-video）：`requireDashboardClientAccess` + `guardGlobalAdmin` 判据；#1649 合并后换 `requireGlobalAdmin`。
- **怎么点**：确认框必须输入主页名（与服务端现查页名逐字一致）；提交后按钮锁定，前端按 `authorization_id` 轮询状态。
- **agent 边界**：agent 只准备（点「准备发布素材」、挂片、填正文与首评草稿、标来源、传九宫格、逐镜检查），记 `prepared_by='agent'`；授权 agent 不点，不得用任何人的登录态代点。
- **`chat_go`**：PM 在对话里对「post id + 表单 sha256 前 12 位」说 go，由一名非 agent 内部员工在表单选「PM 已在对话里授权」并粘贴原话，服务端校验原话含该 post id 与哈希前缀，记 `authorized_via='chat_go'`。

### 4.2 预览、表单绑定与防重复提交

1. 打开预览 → 服务端生成 `authorization_id`（uuid），返回预览数据与该 id；前端把 id 固定在本次表单会话里。
2. 提交时服务端对表单全部内容（post id、copy id、video sha256、正文、首评、落地页、模式、句子来源、画面声明、分镜检查、确认主页名）算 `form_sha256`，与 `authorization_id` 一起交给 `content_reel_authorize`：
   - 同 id 同哈希重复提交 → 返回「处理中」+ 当前状态；同 id 不同哈希 → 409，要求重新打开预览。
3. RPC 超时或网络断 = **结果未知**：不删任何东西，前端提示「正在确认结果」并轮询 `GET …/reel-publish/status?authorization_id=`。
4. 「重新发起发布」（`authorized` 久未领取）：重新展示锁定正文与片子，再次输入主页名，才发新事件 id。

授权记录（写入 `authorization` jsonb，RPC 不提供修改）：

```ts
interface ContentReelAuthorization {
  schema_version: 2
  authorization_id: string
  form_sha256: string
  video_copy_id: string
  authorized_via: 'ui_click' | 'chat_go'
  chat_go_quote?: string
  authorized_by_user_id: string
  authorized_by_email: string
  authorized_at: string
  prepared_by: 'human' | 'agent'
  confirm_typed_page_name: string
  client_id: string
  content_post_id: string
  render_job_id: string | null
  target: { platform: 'facebook'; page_id: string; page_name_seen: string; brand_name_seen: string }
  mode_requested: 'draft' | 'live'
  video: { video_copy_id: string; source_video_url: string; copy_path: string; copy_public_url: string; content_length: number; sha256: string }
  caption_text: string; caption_sha256: string
  first_comment: { mode: 'manual' | 'none'; text: string | null; text_sha256: string | null; landing_url: string | null; landing_reason: string | null; utm: Record<string, string> | null }
  sentence_sources: Array<{ field: 'caption' | 'first_comment' | 'onscreen'; index: number; sentence: string; source: 'website' | 'brief'; ref: string }>
  onscreen_claims: Array<{ text: string; source: 'website' | 'brief'; ref: string }>
  storyboard_check: { grid_path: string; frames: Array<{ index: number; image_ok: boolean; text_ok: boolean; logo_ok: boolean; note?: string }>; watermark_ok: boolean }
  text_checks: { language: string; cjk_found: boolean; internal_terms_hit: string[]; url_in_caption: boolean; comment_reference_in_caption: boolean; price_claims: string[] }
  redline_scan: { hits: string[]; scanned_at: string }
}
```

**授权按钮禁用条件**（服务端再校验一次）：正文必须人填（不用 `title` 预填）、每句有来源、价格句来源为 website、`storyboard_check` 完整（Creatomate 成片同样强制，依铁律 8）、`onscreen_claims`、语言/内部简称（`brand_redline_phrases`）/引用评论/正文含 URL 检查、落地页域名属于 `clients.domain`（该列写入权限依赖 #1699 修复）、红线、页名与品牌或别名匹配、无进行中渲染任务、副本 `ready`。

发布函数 fail-closed 校验：记录缺失、版本不认识、`authorization_id ≠ attempt.id`、`form_sha256` 重算不符、正文/首评 sha256 不符、句子来源不全、分镜检查不全、红线命中。

### 4.3 准备阶段：视频副本（第二轮第 9 项）

1. 员工或 agent 点「准备发布素材」→ 路由调 `content_reel_video_copy_start`（`status='preparing'`，路径 `content-factory/<client>/authorized/<copy_id>.mp4`）→ 发事件 `me/factory.content_reel.prepare_requested`（id = `content-reel-prepare:<copy_id>`）。
2. `cloud-factory-content-reel-prepare`：流式读 `source_video_url`（Supabase 存储直接读；外链走 `safeProbeRemoteFile` 同款逐跳校验，大小上限 1 GB）→ 流式写副本（`upsert:false`）并同时算 sha256 → `…_finish(ready)`。重试时目标已存在：读已有文件算哈希，与本次一致则置 `ready`，否则 `failed(copy_conflict)`。
3. 抽屉显示「素材已准备（哈希前 12 位）」后才出现授权按钮；源片改动（`source_video_url` 变化）后旧副本失效，需重新准备。
4. 发布前重验副本哈希（§3.4 第 4 步）。
5. 副本从不删除（审计证据）；`failed` 副本不可用于授权。

### 4.4 开关（D3 + 第二轮第 8 项）

- `CONTENT_REEL_PUBLISH_LIVE`：环境变量，默认关，全局急停。
- `clients.content_reel_live_enabled`：只能经 `set_content_reel_live_enabled` RPC 修改（期望旧值 + 审计行 + `fde_work_logs`），入口是设置页开关，仅内部员工（授权同级判据）。
- 表单只有两者都为真时才出现「正式公开」选项；领取时再查一次（§3.4 第 3 步）。
- `FACTORY_PUBLISH_LIVE` 不动。

### 4.5 草稿与删草稿（D4 + 第二轮第 3、4 项）

- 本期不转正。流程：可选草稿验格式（`draft_published`，卡片回出片列）→ 人审 → 新授权公开上传。
- **删草稿**：
  - 条件：该帖已有 `published(graph_get)` attempt；`human_confirmed` 的公开**不触发**删草稿，直到 `publish_verified_at` 有值。
  - 删前 `getReelObjectStatus`：必须是 `not_public`（`published===false` 字段真实存在）或 `failed`，才 `deleteReelVideo`；读到 `published`、`processing`、`unknown`、字段缺失、`error` → 不删，出「草稿待删」待办并写明读到了什么。
  - 删后按 §3.4 第 10 步两次缺席 → `draft_deleted`。
  - **自动删草稿默认关闭**（常量 `CONTENT_REEL_AUTO_DELETE_DRAFTS = false`）：首条草稿读回字段存为 fixture 并确认 `published===false` 真实出现之前，跟进函数只出「草稿待删」待办，由员工点「删除草稿」走同一流程；fixture 证实后在单独小 PR 打开。
- **人工确认已公开**：员工必须粘贴 Reel 网址，服务端解析 `/reel/<id>/`（也接受 `facebook.com/…/videos/<id>`）必须等于 `attempt.video_id`，且 GET 读到 `exists`；记 `publish_confirmation='human_confirmed'`；跟进函数 `step.sleepUntil(published_at + 4h)` 后 GET 复核，读到 `published` → 写 `publish_verified_at`，否则 `published → in_doubt`；30 天同哈希检查不计未证实的 `human_confirmed`。

### 4.6 回执

回执 = attempt 行 + 副本行 + 开关审计行。`cron_run_logs` 只留运行历史（`job_name` 静态字面量 `factory-content-reel-prepare` / `-publish` / `-followup`，登记 `UNSCHEDULED_CRON_ROUTES`）；业务结果记 `completed` + `summary.outcome`，函数崩溃或需系统告警时记 `failed`。

---

## 5. 事件与测量

### 5.1 新事件 `me/factory.content_reel.published`

```ts
export const FACTORY_CONTENT_REEL_PUBLISHED_EVENT = 'me/factory.content_reel.published' as const
export const FactoryContentReelPublishedEventSchema = z.object({
  schema_version: z.literal(1),
  request_id: uuidLike,                // = authorization_id（M7）
  authorization_id: uuidLike,
  content_post_id: uuidLike,
  client_id: uuidLike,
  platform: z.literal('facebook'),
  page_id: numericId,
  video_id: numericId,
  post_id: numericId,                  // = video_id
  media_type: z.literal('reel'),
  permalink: z.string().url().optional(),
  published_at: z.string().datetime(),
  status: z.literal('PUBLISHED'),
  no_publish: z.literal(false),
  authorization: z.literal('AUTHORIZED'),
  cost_usd: z.literal(0),
  created_at: z.string().datetime(),
})
```

v1 工单事件一字不改。只在 `state='published'` 且 `publish_confirmation='graph_get'`（或 `human_confirmed` 且已 `publish_verified_at`）时由跟进函数发。事件 id 首次 `me-factory-content-reel-<post>-<video>`，重启 `…-r<n>`（`n` 来自 `content_reel_next_restart_seq`）。实现 PR-C 在 `docs/registry/platform-candidates.md` me_ad_launch 条目补一句「内容 Reel 走独立事件，是否自动建广告待 PM 定」。

### 5.2 测量适配器

- triggers 改数组 `[{event: FACTORY_REEL_PUBLISHED_EVENT}, {event: FACTORY_CONTENT_REEL_PUBLISHED_EVENT}]`，按 `event.name` 分支；类型不支持则退为独立小函数（共用登记与 fan-out），PR 说明函数数变化。
- 内容 Reel 重绑：`flywheel_actions` where `action_type='factory_reel_publish'` and `client_id` and `payload->>content_post_id` and `payload->>video_id` and `payload->>authorization_id` and `payload->>video_state='PUBLISHED'`；幂等键 `factory-content-reel:<post>:<video>`。
- 工单线分支不变。
- 组合 id 的 code 10（X4）：测量消费者照旧当 `graph_error`，不解释为已删。

### 5.3 跟进函数（第二轮第 5 项）

`cloud-factory-content-reel-followup`，`retries: 3`，`onFailure` 写 `followup.last_error` + 运行记录，`concurrency: {key: 'event.data.authorization_id', limit: 1}`。触发：`me/factory.content_reel.publish_recorded`（id `content-reel-followup:<post>:<video>:<authorization_id>`，重启加 `:r<n>`），仅公开记录。

1. 读 attempt，要求 `published`；`human_confirmed` 未证实 → 先 `sleepUntil(T+4)` 复核（§4.5），失败则结束；
2. `content_reel_mark_post_published`；
3. **内容 Reel 独立记账 helper** `recordContentReelBooks()`（新文件，工单线 `writeThreeBooks` 不动）：
   - `flywheel_actions`：按 `(client_id, action_type='factory_reel_publish', payload->>content_post_id, payload->>video_id)` 查重，不存在则插；payload 显式带 `content_post_id / authorization_id / video_id / video_state / page_id / published_at / platform / permalink`；插入失败抛错；
   - `execution_items`：仅当 `content_posts.execution_item_id` 为空才插；
   - `fde_work_logs`：尽力；`vendor='meta_graph'`；
   - `content_reel_followup_patch('books_written', true)`；
4. 发 `me/factory.content_reel.published`，`content_reel_append_event_id`；
5. 删草稿（§4.5，默认只出待办）；
6. `step.sleep('10m')` 后查 `social.publish_post` 行是否存在，写 `followup.measurement_registered`。

发布函数发 `publish_recorded` 失败：`factory-publish-worker` cron 新增独立 try `reconcileContentReelFollowups()`：`published` 超 15 分钟且 `followup.published_event_ids` 为空 → 取新 `restart_seq` 重发（一轮上限 10 条）。

---

## 6. 文案、落地页、首评

### 6.1 正文与首评谁写

- 正文：**人填**（准备者可以是 agent，`prepared_by` 如实记录），不用 `title` 预填，不接 LLM。
- 首评：`publish_rules.first_comment_template` 填入落地页后得到草稿，可改前缀句，URL 只读。
- 发布与首评都用授权记录里的锁定文本。

### 6.2 客户配置 `factory_config.publish_rules`（`FactoryConfigPanel` 同 PR 补表单，铁律 8；整个对象仅内部员工可写，§3.5；客户级公开开关不在这里，见 §4.4）

```jsonc
{
  "caption_language": "en",                            // 触发中日韩字符检查
  "cta_placement": "first_comment",                    // 'first_comment' | 'none'
  "caption_cta_line_auto_comment": null,               // 自动首评可用时的正文引导句（本期不会用到）
  "caption_cta_line_manual": "",                       // 首评为人工时的正文引导句，不得引用评论；可为空
  "comment_reference_patterns": ["in the comments", "in comments"],  // 客户自己声明哪些句式算「引用评论」
  "first_comment_template": "👉 {landing_url}",
  "default_landing_url": "https://www.example.com/list",
  "landing_urls": { "<offer_key>": "https://www.example.com/tour-a" },
  "utm": { "source": "facebook", "medium": "organic_social", "campaign": "default-campaign" },
  "utm_campaign_by_offer": { "<offer_key>": "campaign-a" }
}
```

- 共享代码只认键名与占位符，不含任何客户值；`publish_rules` 缺失 → 表单禁用并指向设置页。
- 落地页：帖子有 `offer_key` 且 `landing_urls[offer_key]` 有值 → 候选之一；`default_landing_url` → 候选之一；人选并填 `landing_reason`。**不再依赖 `verified_cta` 或 `render.creatomate.offers`**（D13 / 6-A）。
- 域名必须属于 `clients.domain`。
- `utm_campaign`：单条表单覆盖 > `utm_campaign_by_offer` > `utm.campaign`。
- `utm_content`：默认 `reel_<post 前 8 位>`，可改；同客户重复**只提示**不拦（D14）。

### 6.3 首评：人工 + 只读核验（D5 + 第二轮第 11 项）

- 首评本期固定 `manual` 或 `none`；无自动首评代码。
- `manual` 时正文禁止命中 `comment_reference_patterns`；引导句来自 `caption_cta_line_manual`，不写死语言。
- 「首评已发·核验」：
  1. 先 `GET /<video_id>/comments?fields=from,message&filter=stream&limit=100`，按 `paging.next` 翻页（上限 10 页）；
  2. 本体读取报错或无结果时，再 `GET /<page_id>_<video_id>/comments` 同样翻页；
  3. 找到 `from.id === page_id` 且 message 含完整 `landing_url` → `verified(from_and_url)`；不返回 `from` 时含完整 `landing_url`（带唯一 `utm_content`）→ `verified(url_only)`；
  4. 没找到 → `pending` + 提示；两处都报错（含 code 10）→ `pending` + 原因码，不据此推断 Reel 已删。

### 6.4 拆句规则（魏征建议 9）

按换行拆行；每行再按 `. ! ?` + 空格拆句；纯 emoji 行、纯 hashtag 行不算句子（但 hashtag 也要过红线与语言检查）；URL 所在行整行算一句，来源为落地页本身（`ref` = 该 URL）。规则实现为一个纯函数，UI 与服务端共用。

### 6.5 自动首评需要 PM 的业务动作（不阻塞本期）

已核实（2026-09-15）：ME 的 Meta 应用对 `pages_manage_engagement` 已是 Standard access，**无需 Meta 审核**。剩余步骤：
1. 把它加进 `META_PAGE_SCOPES`（另一分身的小 PR 正在做）；
2. 该 PR 上线后，内部员工在各客户设置页重新点「连接 Meta」，并用 `debug_token` 确认新 token 带上该 scope；
3. **本期首评仍按人工 + 只读核验实现**；自动首评列为「权限到位后的后续 PR」（带发前查重、失败回落人工待办）。
在第 1–2 步完成并实测前，任何待办文案不得写「重新连接即可自动发首评」。

---

## 7. 今日待办（4 种；第二轮第 7、11 项）

`src/lib/pm-todo/content-reel-items.ts`，拉模式查 attempt 表（分页读全、稳定排序、读失败抛出）。未解决不按天数过期；同一 attempt 同 kind 只一条；**排除 `content_posts.status='rejected'` 的帖子**；href 默认卡片深链 `https://app.magicengine.com.au/dashboard/clients/<client_id>/content-factory?post=<content_post_id>`；按钮名从 UI 文案常量导入。

| kind | 判据 | what | how | href |
|---|---|---|---|---|
| `content_reel_publish_blocked` | `preflight_failed` 且之后无更新 attempt | 「{客户} 的视频《{标题}》没发出去（{原因}）。Facebook 上什么都没发生，卡片已回到出片列」 | 按原因码：**`brand_mismatch`** → ①打开 {页名} 主页确认它确实是 {客户} 的主页；②确认是 → 打开链接（设置页「品牌别名」）把「{页名}」加进别名并保存（仅内部员工可改）；③回卡片重新授权；④不是该客户主页 → 不要加别名，按下一条改发布目标。**`page_binding_mismatch`** → ①打开设置页「Facebook 主页」绑定区，以这里绑定的主页为准；②在「出片配置」里把发布目标主页改成同一个；③只有确认绑定本身选错时，才由内部员工改绑定。**`live_switch_off`** → 这条选了公开但公开开关没开；要么重新授权为草稿，要么先按上线流程开开关（需 PM 同意）。`no_page_token`/`graph_permission` → 设置页「平台连接」点「连接 Meta」后回卡片重新授权。视频/文案类 → 打开卡片按抽屉提示换片或改文案、重新准备素材、重新授权 | 设置页对应区块 / 卡片深链 |
| `content_reel_publish_in_doubt` | `in_doubt`；或 `claimed/uploading` 且 `last_step_started_at` 早于 30 分钟；或 `authorized` 早于 30 分钟**且**同客户没有更早的 `authorized/claimed/uploading`（排队中不算）；或有「草稿待删」；或 `alert_code` 非空 | 按子情形：上传中出错 / 流程卡住 / 授权后一直没开始 / 验格式草稿待删 / **高优先级：草稿读回时已经公开** / **高优先级：判定没有的视频其实公开了** + 「系统不会自动重发」 | 出错/卡住：①点「重新核对 Facebook」；②显示已发布/草稿在后台 → 待办消失；③显示「暂未找到，10 分钟后再核对」→ 10 分钟后再点一次；④显示「未公开，可放弃这次上传」→ 点「放弃这次上传」，10 分钟后再点「重新核对」，确认后卡片回出片列可重新授权；⑤显示「读不到状态」→ 打开 Reel 网址（抽屉给出）看是否公开，公开就点「我已在主页上看到这条公开」并粘贴网址。授权后没开始：点「重新发起发布」（会再次展示正文和片子并要求输入主页名）；不想发了点「撤销授权」。草稿待删：点「删除草稿」，10 分钟后再点一次完成确认。草稿已公开/判定没有却公开：打开抽屉给出的 Reel 网址核对，若与其他公开 Reel 重复，在 Meta 后台删除其中一条后点「重新核对」 | 卡片深链 |
| `content_reel_first_comment_pending` | `published` 且 `first_comment_state='pending'` 且有首评文本；状态变 `removed_externally` 后消失 | 「Reel《{标题}》已经公开，但带链接的第一条评论还没发，看视频的人找不到链接」 | ①打开链接；②切换成 {主页名} 主页身份；③在 Reel 下发评论，整段复制：`{锁定首评原文}`；④回卡片点「首评已发·核验」 | Reel 绝对 permalink |
| `content_reel_measurement_not_started` | `published` 超 30 分钟且无 `social.publish_post`（`factory-content-reel:<post>:<video>`）；`restart_seq >= 2` 且仍无 → **移出人工待办**，改写 `cron_run_logs` `failed`（`measurement_registration_missing_after_restarts`，由既有 cron 健康检查告警）；`removed_externally` 后消失 | 「Reel《{标题}》已公开，但成绩回收没启动，4 小时和 3 天后的点赞、评论不会被记下来」 | ①打开卡片点「重新启动成绩回收」；②10 分钟后刷新，显示「成绩回收中」即完成；③第一次没好就再点一次；两次后系统自动转为技术告警，此待办消失 | 卡片深链 |

---

## 8. CTS 现成 5 条 mp4（D6 / D8）

文件：`content-factory` bucket `cts-reels/goldenchina-ads-20260908-v2/{gc_grandtour,gc_beijing,gc_xian,gc_shanghai,gc_food}.mp4`。

### 8.1 路径（与 Creatomate 成片同一出口）

1. **建卡片**：看板「用已有成片新建」→ `import-video`（内部员工）body `{ title, source_link, offer_key? }`：规范化 `source_link` 后插入 `content_posts`（`status='approved'`、`format='reel'`、`ratio='9:16'`、`platforms=['facebook']`、`route='route_a'`、`source='manual_import'`、**独立列 `import_source_url`**、快照 `offer_key`）；唯一索引冲突 → 返回已有卡片（幂等，D8）。不排渲染（P5：CTS 是 creatomate，从 draft 确认会花钱）。
2. **挂片**：卡片在备料列 → 现成「粘视频链接」（`video/route.ts` `link`）粘同一地址 → 出片列。
3. **准备**（可由 agent，记 `prepared_by='agent'`）：点「准备发布素材」生成副本（§4.3）、九宫格截图上传、逐镜三项检查、画面声明与出处、英文正文、首评、逐句来源。
4. **授权**：只由内部员工本人在界面点击并输入主页名（或 `chat_go`，§4.1）。首条选草稿验格式（读回字段存 fixture，决定自动删草稿与「放弃这次上传」识别能否放开）→ PM 看过 → 新授权选公开。

### 8.2 核对依据

官网团页 `https://www.ctstours.co.nz/tours/china/discovery/golden-china`（2026-09-15 抓取）：*China Discovery — Golden China*、12 Days、**From NZD $4,999 per person**（另 NZD $690 单人房差）、16–27 November 2026、Auckland → Shanghai → Beijing → Xi'an → Shanghai → Auckland。

| 文件 | 标题（内部，**不进正文**） | 落地页候选 | 授权前必须补的证据 |
|---|---|---|---|
| gc_grandtour | Golden China 总览 | `landing_urls.golden_china`（团页） | 九宫格逐镜城市属于线路四城；片尾价格句是否带 From |
| gc_beijing / gc_xian / gc_shanghai | 各城篇 | 画面全是该城且片尾卖 Golden China → 团页；混入线路外城市 → `default_landing_url`（列表页） | 同上 |
| gc_food | 美食篇 | 逐镜证明不了食物出自线路城市 → 列表页 | 逐镜核对 |

以上落地页判断是 CTS 客户规则（memory），只以配置 + 人选 + `landing_reason` 表达。受众为主流英语系新西兰人，正文 NZ 英语。

---

## 9. 范围外与 PM 业务项

**范围外**（实现 PR 合并时登记 ROADMAP）：
1. 自动首评（权限到位后的后续 PR） 2. 草稿转正 3. Tune 读 Reel 回执 4. 广告归因认内容 Reel、me_ad_launch 消费内容 Reel 事件 5. 审片记理由 / 打回重做 6. Instagram、排期发布、公开后撤回按钮 7. LLM 起草正文 8. 讲课片线 sending 超时自动重发 9. 工单线 `writeThreeBooks` 默认 vendor 10. 工单线中断不进待办、`creatomate_render_failed` how 不可执行、工单与讲课片线 `findExisting` 失效（#1697） 11. `expect_brand` 编辑入口 12. 草稿长期未处理提醒 13. 自动删草稿开关打开（fixture 证实后单独小 PR）

**PM 业务项**：
1. 30 天同哈希重复拦截窗口是否合适（先按 30 天实现）
2. 自动首评：权限已无需审核（§6.5），是否在权限到位后排后续 PR 做自动首评由 PM 定优先级
3. 执行数据库变更（PR-A）需单独 go
4. 合并三个 PR 各需 go
5. 打开 `CONTENT_REEL_PUBLISH_LIVE`、打开 CTS 客户级开关、首条公开发布需 go
6. 内容 Reel 是否自动建广告（登记待定）
7. 回滚时若要删客户，外键 RESTRICT 改 NO ACTION 需 go（§10.5）

---

## 10. 测试、探针、上线、回滚

### 10.1 探针结论与降级

| # | 结论 | 设计采用 / 降级 |
|---|---|---|
| X1 | 零宽标记被剥 | 放弃标记与 `findExisting`；数据库 `video_id` 唯一可信源；不用可见文本标记 |
| X1′ | 单个视频 GET 返回 `published`、`status.video_status`、`status.*_phase.publish_status`、`permalink_url`（相对）——**已证实** | `getReelObjectStatus` 的 `published` 分类直接用；permalink 用 `normalisePermalink` 补全 |
| X2 | 列表无草稿样本 | 不依赖列表 |
| X4 | 100/33 不可区分；组合 id code 10 | 主页可读探针 + 两次缺席 + 删除记录 + 时间下限；code 10 当失败 |
| 剩余 | 草稿的 `published`/`publish_status` 取值；未完成容器与 `error` 的字段形状 | 首条草稿读回存 fixture；证实前：草稿读回非 `published` 即记 `draft_published`；删草稿与「放弃这次上传」只在 `published===false` 真实出现或 `video_status==='error'` 时执行，否则待办 + 人工确认 |

### 10.2 测试（A 级，D15）

- **本机 PG 沙盘真跑**（PR-A）：全部 migration；部分唯一索引并发；`content_reel_authorize` 双会话并发只成一；同 id 同哈希返回 duplicate、不同哈希拒；`post_already_published`；30 天同哈希（含 `human_confirmed` 未证实不计）；迁移表每条合法/非法；终态不回退；`video_id` 不可改；`not_on_facebook` 三种 SQL 条件（无 video_id 的 5 分钟、有 video_id 缺删除记录拒、时间不足拒）；`removed_externally` 时间条件；`cancelled` 与领取同时发生只成一；帖子退回 `approved` 同事务；`abandon_post` 条件；`set_content_reel_live_enabled` 期望旧值不符拒 + 审计行；`followup_patch`/`append_event_id`/`next_restart_seq` 并发；外键 RESTRICT；`anon`/`authenticated` 调 RPC 被拒；`search_path` 生效。
- **单元/集成**（fake supabase 按表建模；假 Graph 用 §1.3 真实返回做 fixture）：
  - 授权：非精确名单 / 域名匹配管理员 / scoped / 共享邮箱 → 403；主页名输错；表单禁用条件逐条；副本未 ready；重复提交同 id；RPC 超时不删副本并返回可轮询状态。
  - 准备函数：流式哈希；重试遇已存在文件哈希一致置 ready、不一致 failed；外链逐跳校验。
  - 发布函数：`transition_lost` 零 Graph 调用；`live_switch_off`；strict 超时参数实际传入（断言 AbortSignal 存在）；`beforeWrite` 刷新时间；`beforeWrite('finish')` 状态不符 → finish 调用次数 0；`onStarted` 失败 → rupload/finish 0 次；阶段判定；catch 中 `transition_lost` 重读不覆盖；草稿读回公开 → `in_doubt` + alert；副本哈希不符拦；历史视频检查各分类；全流程零次 `findExisting`、正文无零宽字符；所有 Graph 调用在 `step.run` 回调内（用 fake step 记录调用栈）。
  - 核对 / 放弃 / 人工确认：主页探针失败不算缺席；code 10 不算缺席；两次间隔；`exists` 清零；放弃在 `published`/`processing`/`unknown`/`error` 拒；人工确认网址编号不符拒、GET 非 exists 拒；`human_confirmed` T+4 复核失败退 `in_doubt`；`not_on_facebook` 读到公开 → `published` + alert。
  - 跟进：按授权 id 串行配置；独立记账 helper 查重、payload 字段齐全、失败抛错不发事件；已有 `execution_item_id` 不插；工单线 `writeThreeBooks` 文件 diff 为零；自动删草稿常量为 false 时只出待办；重启序号原子递增。
  - 测量：工单线测试零改动通过；内容 Reel 重绑缺任一条件不命中。
  - 首评核验：先本体后组合 id；翻页；`from_and_url`/`url_only`/未找到/报错。
  - 待办：4 种判据；排除 rejected；同客户排队不算卡住；两次重启后移出并写 failed 运行记录；`brand_mismatch` how 不含「改品牌名」；按钮文案逐字一致。
  - 旧入口（PR-B）：7 个入口各一条 409 + 读表失败 503；`brand-aliases` 客户写 403、员工写 200；`/api/posts/[id]` 仅进行中/已发布拦。
  - Inngest 配置读实际 opts：prepare `retries 2`、publish `retries 0` + client 并发 1、followup `retries 3` + `onFailure` + 授权 id 并发 1。
- **Mutation 清单**（冻结 head 跑一次，探针先断言锚点命中）：
  1. `onStarted` 吞掉 `transition_lost`/数据库错误
  2. 缺席判定去掉主页可读探针（100/33 直接当已删）
  2b. `code 10` 当作缺席证据
  2c. 恢复用零宽标记/`findExisting` 判定已发（测试断言 Graph fake 的 description 读取次数为 0）
  3. `confirm` 放宽为任意状态
  4. batch `updateStatus`/`delete` 放行有 attempt 的帖子
  5. `/api/posts/[id]` 放行 status 修改
  6. 授权/重试/跟进/重启事件 id 去掉序号或授权 id
  7. 首评 manual 时放行正文引用评论
  8. 部分唯一索引去掉 `in_doubt`
  9. RPC 迁移表允许终态回退
  10. `not_on_facebook` 去掉两次间隔确认
  11. 开关判断去掉 `CONTENT_REEL_PUBLISH_LIVE` 或 `live_enabled` 任一
  12. strict 模式恢复 system token 回退 / 品牌空放行
  13. 上传改用 `source_video_url` 而非副本
  14. 同哈希 30 天检查删除
  15. 历史 video_id 检查删除
  16. 跟进在 DRAFT 也触发
  17. 测量待办判据改回「事件已发出」
  18. 内部员工判据退回 `role==='admin'`
  19. `storyboard_check` 校验删除
  20. 待办查询读失败返回 `[]`
  21. `beforeWrite('finish')` 复核删除
  22. strict 超时去掉任一 AbortSignal
  23. `not_on_facebook` SQL 去掉 `video_deleted_at` 条件
  24. `not_on_facebook` 时间下限改小于 17 分钟
  25. `cancelled` 迁移不加行锁
  26. 草稿读回公开时照记 `draft_published`
  27. 删草稿前 GET 确认删除 / 字段缺失时照删
  28. 人工确认不比对网址编号
  29. `human_confirmed` 计入 30 天同哈希
  30. 跟进并发 key 去掉
  31. 记账 helper 失败时继续发事件
  32. `post_already_published` 检查删除
  33. 授权判据退回 `guardGlobalAdmin`（接受域名匹配）
  34. `brand-aliases` 写入放回客户可写
  35. 待办判据不排除 rejected
  36. catch 中 `transition_lost` 时直接覆盖为 `in_doubt`
  37. `live_switch_off` 时改发草稿

### 10.3 审查

本 v2.1 为设计定稿，不开第三轮。每个实现 PR：子牙 + 魏征审（#964，A 级最多两轮）；PR-B 与 PR-C 加狄仁杰攻击验证。

### 10.4 上线步骤

见 §14 各 PR 的上线步骤。测量 trigger 上线验证：**不能只看 `function_count`**（改 triggers 数组函数数不变）——PUT 同步后发一条故意不合法的 `me/factory.content_reel.published`（`schema_version: 999`，测试客户 id），在 Inngest 运行列表确认适配器被触发并返回 `invalid_payload`；或经 Inngest API 读取该函数配置确认 triggers 含新事件。首发后日历提醒：+4 小时后上午 9 点、+3 天上午 9 点；（原「CTS Meta 授权 11-02 到期前提醒」作废：真实主页 token 永不过期，§1.1 P6。）

### 10.5 回滚顺序（第二轮第 10 项）

1. 关 `CONTENT_REEL_PUBLISH_LIVE`，并把所有客户 `content_reel_live_enabled` 经 RPC 置 false（留审计）；
2. 把进行中记录处理成终态：`authorized` → 撤销；`claimed/uploading` 等函数结束或按核对流程处理；`in_doubt` 按核对/放弃流程处理到 `published` / `not_on_facebook` / `draft_published`；**禁止直接改库跳过**；
3. 回退应用代码：发布区 UI 与路由、3 个 Inngest 函数、测量 trigger 数组、跟进对账 try、待办、以及 7 个入口防护与 `brand-aliases` 收紧（PR-B 可单独保留，它不依赖发布功能；若回退 PR-B 则需确认表内无进行中/已发布记录，否则防护必须保留）；回退后 PUT 同步 Inngest 并核对函数清单；
4. `DROP FUNCTION` 各 RPC；
5. 表有数据**保留**，`service_role` 读权限不撤（审计证据），新增列保留；空表可删；
6. 外键 `ON DELETE RESTRICT` 期间删除有记录的客户或帖子会失败——这是有意的；如需删客户，改 `NO ACTION` / 先归档记录需 PM go。

---

## 11. Reuse Statement

- **复用**：`facebookReelAdapter.publish`、`assertBrandMatches`、`normalisePermalink`、`scanPublishCaption`、`validateVideoUrl`、`resolveTarget`（均只加 export）、测量登记与 fan-out、测量消费者与回执表、`video/route.ts` 挂片、`safeProbeRemoteFile`、渲染任务判据、`guardGlobalAdmin` / `isGlobalAdminEmail`、`clients.brand_aliases` / `brand_redline_phrases` / `domain` / `facebook_page_id`、`price-claim` 口径、`loadManualItems`、`FactoryConfigPanel` / `BrandAliasesPanel`、`cron_run_logs`、SECURITY DEFINER 惯例。
- **platform-shared 新增**：副本表、attempt 表与 RPC 状态机、开关列与审计表、授权门槛与表单绑定、`publish_rules` 配置契约、内容 Reel 事件、内容 Reel 记账 helper、适配器 strict/超时/beforeWrite/对象状态/删除加法、准备/发布/跟进 3 个函数、4 种待办、`import-video`、7 个入口防护。
- **industry-specific**：无。
- **client-specific**：CTS `publish_rules`、品牌别名、内部简称红线、5 条成片准备内容；全部为配置或内容行。
- **客户事实进 shared runtime**：没有。`SHARED_ADMIN_MAILBOXES` 是 ME 内部平台常量。
- **学习沉淀**：①整列读-改-写的 jsonb 共享列不能承载需要锁的状态；②Facebook 会剥掉描述里的零宽字符；③100/33 分不出已删/不存在/无权限，组合 id 删除后是 code 10；④客户可写的字段不能当防误发依据。②③已由探针实测，可写全局 memory。
- **tier-gate 对账**：与决策一致，未新增能力目录。

---

## 12. 仍未证实

| # | 假设 | 验证 |
|---|---|---|
| U2 | `video_reels` 列表是否含 DRAFT | 首条草稿后只读 GET（设计不依赖） |
| U2b | 草稿对象的 `published` / `status.publishing_phase.publish_status` 取值；上传未完成容器与 `video_status=error` 的字段形状 | 首条草稿读回存 fixture（§10.1 已给降级） |
| U3 | 「主页可读但视频级不可读」时 100/33 的出现频率 | 生产观察 |
| U4 | 评论读取是否返回 `from`；`GET /<video_id>/comments` 对 Reel 是否可用 | 首条公开后核验时实测（已给组合 id 与 `url_only` 降级） |
| U5 | 操作人个人号能否切成 CTS 主页身份发评论 | 首发时真人确认 |
| U6 | ~~`pages_manage_engagement` 是否需 Meta App Review~~ **已证实无需审核**（§1.1 P3）；重连后新 token 是否真的带上该 scope | 权限 PR 上线后重连并 `debug_token` 确认 |
| U7 | Render 上 Inngest step 请求最长时长；`retries:0` 下 SDK 超时是否重投；超时后原进程是否继续跑 | 文档 + 实测；§3.2 的 30 分钟下限已按「原进程继续跑满全部超时」保守设定 |
| U8 | 大文件 rupload 拉副本耗时是否在 15 分钟内 | 首条草稿实测；超出则调大超时并同步调大 SQL 下限 |
| U9 | Supabase Storage 流式读写 + 哈希在准备函数单步内完成（1 GB 上限） | 5 条 mp4 实测 |
| U10 | inngest ^3.54 triggers 数组类型支持 | 实现时编译（已给退路） |
| U12 | 5 条片尾是否写「From NZD $4,999」、画面城市是否在线路内 | 分镜自检 |
| U13 | 带链接评论是否被限流或隐藏 | 首发后观察 |
| U14 | 设置页「品牌别名」「Facebook 主页」「出片配置」区块的准确 URL/锚点 | 实现时读页面路由 |
| U15 | `DELETE /<video_id>` 对 Reel 草稿用 `pages_manage_posts` 可行（2026-09-06 探针「发完即删」为间接证据） | 首条草稿删除实测 |

已证实并移出：零宽标记（X1，已证伪）；单个视频 GET 的 `published`/`status` 字段（X1′）；删除/不存在返回形状（X4）；`brand_aliases` 列与设置面板存在（F35）。

---

## 13. 复审意见 → 落点

### 13.1 第一轮 · 子牙阻断 1–11

| # | 意见 | 落点 |
|---|---|---|
| 1 | 授权角色太宽 | §4.1（授权用精确名单，其余用 `guardGlobalAdmin` 判据） |
| 2 | 缺品牌名/页名放行；token 回退 | §2.1 strict、§3.4 第 4 步（含别名与 `page_binding_mismatch`） |
| 3 | `onStarted` 落锁无条件 | §3.4 第 5 步 |
| 4 | 人工标「没有」致双发 | §3.4 第 10、11 步（无人工标记；删除记录 + 主页可读 + 两次缺席 + 时间下限） |
| 5 | 补发同 id 被吞；authorized 无待办 | §3.3 迁移、§4.2 重新发起、§5.1/§5.3 `r<n>`、§7 |
| 6 | 其他入口绕过 | §3.5（7 个入口） |
| 7 | 另起事件名 | §5.1 |
| 8 | 成绩回收待办判错 | §7 |
| 9 | 草稿三本账 / 跟进 id | §5.3 仅公开触发 |
| 10 | 共用全局开关；转正兜底 | §4.4；本期无转正（§4.5） |
| 11 | 落地页依赖旅游字段；首评人工核验 | §6.2、§6.3 |

### 13.2 第一轮 · 魏征必修 M1–M13

| # | 落点 |
|---|---|
| M1 | §3.1 独立表 + 部分唯一索引 + RPC 迁移表 |
| M2 | §3.5 |
| M3 | §3.2 同事务退回 `approved` |
| M4 | §4.3 副本 + 哈希 + 发布前重验 |
| M5-1 | §3.4 第 5 步 |
| M5-2 | 被 X1 取代：不用 `findExisting`，`getReelObjectStatus` 三态 |
| M5-3 | §3.4 第 6 步 |
| M5-4 | §3.4 第 10 步 + §3.2 SQL |
| M5-5 | §3.4 第 4 步历史视频检查 |
| M6 | §5.2、§5.3 |
| M7 | §5.1 |
| M8 | §4.4 |
| M9 | 本期无转正（§9） |
| M10 | §6.3、§6.5 |
| M11 | §7 |
| M12a/b | §4.2 |
| M12c | §4.1 |
| M12d | §3.1 `import_source_url` 唯一索引 + §3.2 同哈希 |
| M13 | §4.1 |

第一轮建议项去向（v2.1 调整：函数改 3 个见 §2.1；`writeThreeBooks` 改为不复用见 §5.3）：

| # | 意见 | 落点 |
|---|---|---|
| 建议 | 函数 2 个、核对同步、helper 只加 export、回执与 status 分写、已有执行项不插、渲染中不许授权、原始字符串锁、删 own_comment_count/resend/§3.6、utm.campaign 覆盖、去「报名」、价格复用 gate、待办 4 种、utm_content 降提示 | §2.1、§3.2③、§5.3、§4.2、§5.2、§6.2、§7 均已落；「原始字符串乐观锁」因改用独立表 + 行锁 RPC 不再需要；§3.6 加表方案改为默认方案（D1 否决了子牙「删加表方案」的建议） |
| 建议 1–10 | 原始字符串锁、回执有界重试、GET 确认才 published、上传未完成分类、落地页域名与理由、重绑加条件、长期草稿提醒、授权到期提醒、拆句规则、import 字段核对 | 1：改用行锁 RPC 不再需要；2/3：§3.4 第 7 步；4：并入 X4 探针结果（`processing` 分类），无 video_id 前的失败直接可重新授权；5：§4.2、§6.2；6：§5.2；7：§9-12；8：§10.4 第 7 步交协调方；9：§6.4；10：§12 未列——`format/ratio/source/route` 已由仓库 migration 与既有 `generate`/Launch Hub 写入路径证实存在（`20260528000001`、`20260617000001`、`generate/route.ts:38-47`），实现前仍做一次只读确认 |

### 13.3 探针 → 落点

| 实测 | 落点 |
|---|---|
| X1 零宽被剥 | §1.3、§2.1、§3.4 第 5 步、§10.1 |
| X1′ 单个视频 GET 字段已证实 | §1.3、§2.1 分类、§10.1、§12 移出 |
| X2 列表无草稿 | §10.1、§12 U2/U2b |
| X4 100/33 与 code 10 | §2.1、§3.4 第 10 步、§6.3、§10.1 |

### 13.4 第二轮裁决 1–12 → v2.1 落点

| # | 裁决 | 落点 |
|---|---|---|
| 1 | 状态机补出口 | §3.1 状态、§3.2 SQL 条件、§3.3 迁移表、§3.4 第 7/8/11/12 步 |
| 2 | 单步时长写死 | §2.1 strict 超时与 `beforeWrite`、§3.2 30 分钟下限推导、§3.4 第 5 步 |
| 3 | 删草稿前确认未公开；自动删默认关 | §4.5 |
| 4 | 人工确认收紧 | §3.2 同哈希条件、§3.3、§4.5 |
| 5 | 跟进并发 + 独立记账 + 原子 RPC | §2.1、§3.2、§5.3 |
| 6 | 入口防护补全 + `post_already_published` | §3.2、§3.5 |
| 7 | 待办 how 不教绕过 | §3.5 `brand-aliases` 收紧、§7；**别名写入原本客户可写（F35），因此同时收紧写入权限**，否则 how 本身就是绕过口 |
| 8 | 权限与开关 | §3.1 独立列 + 审计表、§3.2 RPC、§3.5、§4.1、§4.4；`clients.domain` 写入依赖 #1699 |
| 9 | 提交防重复 + 异步准备 | §2.1 第 3 个函数（偏离 D14 的理由）、§3.1 副本表、§4.2、§4.3 |
| 10 | 回滚顺序 | §10.5 |
| 11 | 小项 | `live_switch_off` §3.4 第 3 步；claimed 5 分钟 §3.2；`not_on_facebook → published` §3.3；trigger 验证 §10.4；Graph 在 step 内 §2.1；首评核验顺序与翻页 §6.3；`import_source_url` 独立列 §3.1 |
| 12 | 30 天窗口 | §9 PM 业务项 1 |

---

## 14. 实现拆分计划（3 个 PR，可独立审、独立回滚）

依赖顺序：**PR-A（apply 后）→ PR-B → PR-C**。PR-B 的 409 检查要读 attempt 表，表不存在会 fail-closed 返回 503，所以必须在 PR-A 的数据库变更执行后才能上线。

### PR-A · 数据层（A 级：migration + SECURITY DEFINER）

- **范围**：一个 migration 文件：`content_reel_video_copies`、`content_reel_publish_attempts`、`content_reel_live_switch_events` 三张表 + RLS；`clients.content_reel_live_enabled`、`content_posts.import_source_url` 两列 + 索引；§3.2 全部 RPC（含权限收紧与 `search_path`）；`src/lib/factory/content-reel/rpc.ts` 类型化封装与 zod 返回校验（无调用方）。
- **前置依赖**：无。
- **验收**：本机 PG 沙盘（造 Supabase 角色与桩）顺序跑全部 migration 通过；§10.2「PG 沙盘」全部用例；RPC 封装单测；`npm run build`、相关 type-check 交集为零新增。
- **上线**：PM go merge → PM **单独 go 执行数据库变更** → 查 `supabase_migrations.schema_migrations` 确认版本在 → 只读查三表存在、策略为 `TO service_role`、函数 `proconfig` 含 `search_path`、`anon` 无 EXECUTE。
- **独立回滚**：无应用代码调用；`DROP FUNCTION` + 空表 `DROP TABLE` + 删两列（列上无数据时）。
- **风险**：零运行时影响（无调用方）。

### PR-B · 旧入口状态防护（A 级：鉴权 + 发布入口）

- **范围**：§3.5 表中除 `schedule` 规则与 `factory-config` 以外的全部改动：`[postId]` PATCH 的 `confirm`/`reject` 条件；`/api/posts/[id]`、`/api/posts/batch`、`production/[packageId]/schedule`、`visual/batch-image`（链接 #1699）、`publer/create-post`、`content-posts/[postId]/publish` 共 7 个入口的 409/503；`brand-aliases` 写入收紧为内部员工；共享检查函数 `assertNoLockingReelAttempt(postIds)`。
- **前置依赖**：PR-A 的数据库变更已执行。
- **验收**：每入口允许/拒绝两路径 + 读表失败 503；`brand-aliases` 客户 403 / 员工 200；`confirm` 从 scheduled/published 拒、从 draft/rejected 放行；现有这些路由的既有测试全绿；mutation 3/4/5/34；狄仁杰攻击验证（客户账号逐个打 7 个入口）。
- **上线**：PM go merge → 部署后用内部员工与客户测试账号各验一次（表内此时无记录，409 分支不触发，验证「不误伤」）。
- **行为变化需告知**：客户本人不能再改品牌别名；从已排期/已发布状态点「确认」会被拒。
- **独立回滚**：纯应用代码，回退即可；表内有进行中/已发布记录后回滚 PR-B 前须确认（§10.5 第 3 步）。

### PR-C · 发布功能（A 级：对外发布副作用）

- **范围**：适配器加法（strict / 超时 / `beforeWrite` / `getReelObjectStatus` / `deleteReelVideo`）与 publish-worker 三个 helper 加 export；3 个 Inngest 函数及登记；路由（预览、准备、授权、状态轮询、撤销、核对、放弃上传、放弃内容、人工确认、首评核验、删草稿、重启、重新发起、`import-video`、开关 RPC 路由）；看板抽屉 UI + `?post=` 深链；`FactoryConfigPanel` 的 `publish_rules` 分区与开关 UI；`factory-config` PATCH 权限；`[postId]` PATCH `schedule` 规则；内容 Reel 事件 schema；测量适配器 triggers 数组与内容 Reel 重绑；内容 Reel 记账 helper；`reconcileContentReelFollowups`；4 种待办；`UNSCHEDULED_CRON_ROUTES` 登记；registry me_ad_launch 补句。
- **前置依赖**：PR-A 已执行、PR-B 已上线（别名写入已收紧，预检才可信任别名）；#1649 若已合并则直接用 `requireGlobalAdmin`。
- **验收**：§10.2 除 PG 沙盘与 PR-B 外的全部用例；mutation 全清单中与 PR-C 相关条目；工单线 `publish-worker.test.ts`、`reel-published-emit.test.ts`、测量适配器既有测试零改动全绿；`npm run build`；子牙 + 魏征 + 狄仁杰。
- **上线**：
  1. PM go merge → 等 Render 部署 Live → `PUT /api/inngest`，`function_count` = 部署前 + 3，并按 §10.4 验证测量 trigger；
  2. 内部员工填 CTS `publish_rules`；`content_reel_live_enabled` 保持 false；
  3. 建 `gc_grandtour` 卡片 → 准备素材 → 员工授权**草稿** → 验草稿在后台、`draft_published`、无跟进/测量/首评待办；读回字段存 fixture（回填 U2b）；
  4. PM go live → 设 `CONTENT_REEL_PUBLISH_LIVE=true` + 员工经 RPC 开 CTS 开关；
  5. 新授权公开 → 验 `published(graph_get)`、帖子 published、两行 flywheel_actions、两条 measure_due、首评待办出现 → 人发首评 → 核验通过；「草稿待删」待办出现 → 员工删除并两次确认 → `draft_deleted`；
  6. 建日历提醒；首条跑满 T+72 无残留后其余 4 条逐条准备、逐条授权。
- **独立回滚**：§10.5 第 1–3 步；PR-A 表与 PR-B 防护保留。

---

## 15. PR-A 数据层实现与本文的对齐说明（2026-09-15）

实现文件：`supabase/migrations/20260915140000_content_reel_publish_attempts.sql`、`scripts/content-reel-publish-probes.sql`、`scripts/content-reel-publish-db-check.sh`、`scripts/content-reel-publish-rollback.sql`、`src/lib/factory/content-reel/contract.ts`。

| # | 与 §3 的差异 | 理由 |
|---|---|---|
| 1 | 列 `authorization` 改名为 `authorization_record` | `AUTHORIZATION` 是 Postgres 保留字，裸用会让每条 SQL 都要加引号 |
| 2 | 迁移表增加「同状态」迁移：`claimed→claimed`、`uploading→uploading`、`in_doubt→in_doubt`、`published→published`、`draft_published→draft_published` | §3.4 的心跳刷新、缺席证据、删除记录、首评核验都要在不改状态的前提下写字段；它们走同一个加锁 RPC，不另开写入口 |
| 3 | 证据类时间戳不接受调用方传值，改为标记键：`touch_last_step` / `mark_absence` / `clear_absence` / `mark_video_deleted` / `mark_publish_verified` / `mark_first_comment_verified`，由数据库时钟写入 | 否则调用方传一个很早的时间就能绕过 30 分钟 / 10 分钟下限 |
| 4 | 迁移规则的「唯一真相源」放在 BEFORE UPDATE 触发器（非法迁移、终态不回退、证据条件、身份列不可改、`video_id` 只写一次、行不可删），RPC 负责加锁、帖子状态联动，并把预期内的拒绝（`claimed_too_recent` / `not_on_facebook_requires_deletion` / `absence_not_confirmed_twice` / `last_write_too_recent` / `draft_deleted_requires_deletion`）翻译成 `{ok:false, code}` | service_role 绕过 RLS；只放 RPC 的话，将来任何一处直接 UPDATE 都能跳过全部规则 |
| 5 | `not_on_facebook` 在无 `video_id` 时只允许从 `claimed` 出发（去掉 §3.2 的「或来源是 preflight」） | 预检失败走 `preflight_failed`，不需要第二条路 |
| 6 | 缺席证据必须晚于删除记录（`absence_first_confirmed_at >= video_deleted_at`） | 删除之前记的「不在」不能算删除之后的确认 |
| 7 | 客户级开关表层再加一道触发器：只有在 `set_content_reel_live_enabled` 内部才能改 `clients.content_reel_live_enabled` | 保证「期望旧值 + 审计行」不能被直接 UPDATE 绕过 |
| 8 | 三张新表额外 `REVOKE ALL … FROM PUBLIC, anon, authenticated`；审计表与副本表、发布记录表不可删、不可改已定稿行 | 纵深防御，审计证据 |
| 9 | `content_reel_abandon_post` 签名为 `(p_client_id, p_content_post_id)`，未带操作人 | 操作人记录由 PR-C 路由写运行记录；RPC 只做状态判定 |
| 10 | 回滚脚本放 `scripts/content-reel-publish-rollback.sql`（不进 migrations 目录），有数据时保留表并只删 RPC；此时客户级开关的触发器仍在，开关将无法再改（回滚第 1 步已置 false） | 仓库没有回滚目录惯例；放 migrations 会被当成正向变更自动执行 |
| 11 | 交付的是 `src/lib/factory/content-reel/contract.ts` 类型与常量词表（状态、合法迁移、补丁键、跟进键、拒绝码、时间下限），**不是** §14 写的 `rpc.ts` 类型化封装 + zod 返回校验 | PR-A 零调用方；RPC 封装与返回值校验随第一个调用方（PR-C）一起写，避免无人调用的封装与真实返回形状漂移。`contract.test.ts` 从 migration 文本回读，保证词表与数据库一致 |

### 15.1 PR-A 实施后第一轮两审（子牙 + 魏征）修正（2026-09-15）

| 复审项 | 修正 | 探针 / mutation |
|---|---|---|
| 子牙 B1 = 魏征 M2：证据时间戳可被 service_role 直接 UPDATE 伪造 | INSERT 强制 `created_at/updated_at := now()`，六个证据列必须为 NULL；UPDATE 时六个证据列一旦变化必须恰好等于 `now()`（仅缺席证据允许清回 NULL），否则 `evidence_timestamp_db_clock_only`；外部删除下限不再用调用方传入的 `published_at`，改为 `GREATEST(last_step_started_at, publish_verified_at, finished_at, created_at)`（取最晚的库时钟时刻，最保守） | K09–K14、E09b；N1/N1b/N1c/N15/N22 |
| 子牙 B2 = 魏征 M3：已公开期间同状态写可抹掉回执 | 已公开状态每次写都校验完整回执；`video_state / published_at / publish_confirmed_by_user_id` 不可改；`publish_confirmation` 只允许 human_confirmed→graph_get 且同时有 verified_at；进入已公开 / 草稿已发时缺席证据必须为空（RPC 自动清）；外部删除要求缺席晚于发布标记 | K17–K24b、E09a；N2/N2b/N2c/N2d/N2e/N16 |
| 魏征 M1 = 子牙 S1：记账类更新在 authorized / 终态被迁移表拒绝 | 只动 `followup / trigger_event_ids / restart_seq / updated_at` 的同状态更新任何状态都放行（`to_jsonb` 差集判断） | K01–K04；N3 |
| 魏征 M4 = 子牙 S4：同哈希并发授权两边都成功 | 查哈希前 `pg_advisory_xact_lock(hashtextextended('content_reel_hash:'||client||':'||sha256, 0))` | 并发脚本「同哈希两个帖子」；N4 |
| 子牙 S2：service_role 默认有 DELETE/TRUNCATE | 三表 `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role` 后只回授 SELECT/INSERT(/UPDATE)；三表加 `BEFORE TRUNCATE` 语句级触发器。沙盘重放桩同步还原 Supabase 给 service_role 的默认 ALL（否则这条断言在沙盘上永远假通过） | K32–K35；N5/N5b |
| 子牙 S3 / 魏征建议 6：客户开关 INSERT 绕过、GUC 可被应用自设 | `clients` BEFORE INSERT 拒绝带 `content_reel_live_enabled=true`；UPDATE 需 GUC 标记 **且** `current_user` 为开关函数所有者；锁降为 `FOR NO KEY UPDATE`。**这是防误操作，不是安全边界**：所有者 / 超级用户仍可手动设标记 | K36–K39、H06；N6/N7/N23 |
| 魏征建议 1、2：transition 入参与唯一冲突 | `p_from` 为 NULL / 空数组 / 含 NULL、`p_to` 为空一律报错；唯一冲突翻译为 `video_id_conflict` / `active_attempt_exists` | K06–K08、K29、K30；N8/N9 |
| 魏征建议 3 / 子牙 S8：标记帖子已发布兜底 | 读记录加锁；要求 `publish_confirmation='graph_get' OR publish_verified_at IS NOT NULL`，否则 `publication_not_verified`。**人工确认未证实时不把帖子标为已发布**（与 §4.5 一致） | K16、K22、K24；N10/N21 |
| 子牙 S5 | `not_on_facebook → published` 必须带 `alert_code` | K25/K26；N11 |
| 子牙 S6 | 草稿请求不能进入已公开，公开请求不能进入草稿已发；读回不一致走 in_doubt | K27/K28；N12 |
| 子牙 S7 | 渲染进行中改白名单：`status NOT IN ('ready_for_review','failed')` 之外全算进行中 | K31；N13 |
| 魏征建议 5 | 删除与缺席同一时刻不算（`<` → `<=`），草稿删除同理 | K15、F06b；N14/N19 |
| 魏征建议 9：变异盲区 | 补：草稿删除缺席早于删除、外部删除 30 分钟下限、标记已发布须已公开、外部删除挡再次授权、退回卡片时另有进行中记录不退回、放弃内容有进行中记录拒绝 | F06b、E09b、K16、E10b、K40/K41、K05；N17/N18/N20 |
| 魏征建议 7、8 / 子牙 S12：执行与回滚安全 | migration 首行 `SET LOCAL lock_timeout = '5s'`，两处 ADD COLUMN 挪到最前；必须整体原子执行；回滚脚本前置检查（有进行中记录或任一客户开关为真即报错不动任何东西）、判断前 `LOCK TABLE … ACCESS EXCLUSIVE`、注明账本行保留 | db-check 第 5 步三条 |

**外键 RESTRICT 的完整影响**（此前只写了一半）：①准备过视频副本的帖子删不掉（副本表也 RESTRICT）；②改过公开开关的客户删不掉（审计表 RESTRICT）；③有发布记录的帖子 / 客户删不掉；④PR-B 上线前，`/api/posts/batch` 删除这类帖子会返回 500 并在错误信息里暴露表名（PR-B 改为 409）。

### 15.2 第二轮两审收尾（2026-09-15）

| 建议 | 落地 | 探针 / mutation |
|---|---|---|
| 执行手册按 migration name 查账本；首选 `psql -1`；补失败后检查、列定义与开关函数所有者核对 | PR #1705 描述「执行手册」 | — |
| 魏征 C：另两张表所有者 TRUNCATE 被拒 | 已有触发器，补探针 | L01、L02；N24 |
| 子牙建议 4 / 魏征 D：记账列单调、已公开期间 permalink 写入后锁定 | 触发器：`restart_seq` 不减、`trigger_event_ids` 只增（任何状态都检查，比「只在记账放行路径检查」更严）；permalink 加入已公开不可改列 | L03–L07；N25/N26/N27 |
| 子牙建议 1：删过的视频再读到公开要告警 | 进入 `published` 时 `OLD.video_deleted_at IS NOT NULL` 也要求 `alert_code` | L08/L09；N28 |
| 子牙建议 2：草稿删除须晚于进入草稿 | `draft_deleted` 要求 `video_deleted_at > finished_at`（进入草稿的库时钟时刻） | L10；N29 |
| 魏征 A：草稿请求读到公开的处理 | §3.4 第 8、11 步已改；`contract.ts` 新增 `CONTENT_REEL_GUARD_ERROR_CODES`（含 `mode_state_mismatch`，这些是抛出而非返回的码，所以不并入 `CONTENT_REEL_RPC_REFUSAL_CODES`） | contract.test |
| 子牙建议 3：PR-C 转 published 时比对缺席值 | §3.4 第 8 步已写明；RPC 本期不改 | — |
| 子牙建议 5、6：注释与列快照 | migration 头注释写明长事务 `now()` 偏早；`contract.ts` 写明 PR-C 不得用应用时钟写证据列；`contract.test.ts` 加发布记录表列清单快照 | contract.test |
