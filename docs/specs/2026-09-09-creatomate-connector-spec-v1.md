# Creatomate Connector 接入计划 · 内容工厂"确认出片"入口重新点亮 · spec v2

> 起草：Claude Code · v1 2026-09-09 · **v2 2026-09-09（子牙+鲁班+魏征三方并行复审后重写，见 §10 改动清单；定稿前另查到 window bda74d92 立项记录，补回 §4.3a 场景素材编排，避免漏掉 PM 要求的"编排 imageToClip+shot-guards+creatomate"）**
> 审查沿革：v1 → 子牙（架构，❌不能进 GO BUILD）+ 鲁班（执行视角，❌预算不现实）+ 魏征（挑刺，❌）三方并行复审 → v2 全部吸收，核心架构从"接现有渲染管线"改为"重新点亮一个已知的死入口"
> Tier 判定：**L3 Connector**（me-platform-tier-gate 已过，理由见 §2）——挂在既有"内容工厂"能力下，不新增能力线，不登记 platform-candidates
> 对外大白话名（提案，待复核）：复用 **Video Studio**
> 状态：spec v2 · 未写任何生产代码 / migration / cron
> 数据来源声明：Creatomate API 字段/端点/计费公式来自官方文档实测抓取（2026-09-09，逐条附来源）；仓库现状为 2026-09-09 只读盘点，逐条附 `文件:行号`，v2 版本额外做了三方复审要求的二次核实（不是单信复审报告转述，是自己重新 grep/Read 验证过一遍）；Essential 档 **$54/月，PM 2026-09-09 确认已订阅**（v1 曾误引一份 5 天前的旧登记记成 $45/月，已在 [`docs/registry/platform-candidates.md`](../registry/platform-candidates.md) 同步更正）
> 前情：延续 window bda74d92 的 4 个已合 PR（[#1351](https://github.com/bigbigraydeng-maker/magic-engine/pull/1351) / [#1360](https://github.com/bigbigraydeng-maker/magic-engine/pull/1360) / [#1367](https://github.com/bigbigraydeng-maker/magic-engine/pull/1367) / [#1373](https://github.com/bigbigraydeng-maker/magic-engine/pull/1373)）和 [#1396](https://github.com/bigbigraydeng-maker/magic-engine/pull/1396) 登记的分档配额闸候选

---

## 0. 一句话

**PM 已经在 Creatomate 编辑器里手搭好模板、订阅已生效。这次要做的是把 2026-09-02 主动关掉的"确认选题→自动出片"入口重新点亮——但用 Creatomate 替代当年的 ffmpeg 拼接，而且只对配置了 Creatomate 模板的客户生效，不影响任何其他客户。v1 曾经打算把新功能接到一条已经停摆两周、没有 worker 在跑的旧表上；v2 改为直接把这条入口跟 Creatomate 绑定，不再依赖那套已经不存在的分镜/配音/ffmpeg 流程——这也让整个连接器比 v1 设计的更简单。**

---

## 1. 现状盘点（2026-09-09 · v2 二次核实，非转述复审报告）

### 1.1 v1 的事实错误，以及为什么现在能确定是错的

v1 §1 写"现有视频渲染管线由本机 worker（`scripts/factory-worker/`）驱动"——**这句话有两处错**，逐条附本次亲自核实的证据：

| 错误 | 证据 |
|---|---|
| 驱动它的不是 `scripts/factory-worker/` | 真正调用 `runRenderGeneration()` 的是 `scripts/render-worker/worker.ts:6`（"跑在 Render 独立容器"的常驻轮询脚本），跟 `scripts/factory-worker/`（另一套广告创意工单系统）是两个不相关的东西 |
| 这条管线还在跑 | [`render.yaml:997-1006`](../../render.yaml) 明文：「🔴 2026-09-02 退役：content-factory-render-worker（旧 Render 云端拼片管线）。`content_factory_render_jobs` 表最后一条记录 2026-08-19，两周零产出，当前无客户在用（PM 口径）」。**该 Render 服务定义已经从 `render.yaml` 里整个删掉**（本次重新 grep 全文件，`render-worker` 只出现在这条退役注释本身里，没有任何 `startCommand`/服务块） |
| "确认"按钮的真实行为 | [`src/app/api/clients/[id]/content-factory/[postId]/route.ts:119-129`](../../src/app/api/clients/[id]/content-factory/[postId]/route.ts) 已经在 2026-09-02 被显式改成：点"确认"直接返回 `render.error = '旧拼片管线已退役，出片暂无自动管线，需人工处理这条内容'`，**不再调用** `enqueueRenderJob` |

**这不是巧合的两处证据，是同一次改动（2026-09-02）留下的三份互相印证的记录**，v1 起草时只读了 `render-pipeline.ts`/`render-assemble.ts` 的代码逻辑本身，没查这段代码有没有被下线——这是 v1 审计不到位，不是复审记错。

### 1.2 那"活着"的另一条线是什么，为什么不能往那边接

route.ts 同一段注释接着写：「`content_work_orders` 现在只服务**广告成片工单**（`review-sync.ts` 从 Airtable Winner Intake 建的），不是这条普通内容的替代管线；本机 `scripts/factory-worker` 目前**也没有从 `content_posts` 自动建工单的桥**」。

核实 `src/lib/factory/types.ts:16` 的 `OrderType = 'variant_from_winner' | 'fresh_angle' | 'clip_generation'` 和 `SignalType`（`creative_fatigue`/`scale_winner`/`new_campaign`/`asset_gap`）——`content_work_orders` 整套语义是"广告创意疲劳后要不要出新变体"，跟"一条已经写好标题/文案/视觉需求的内容帖子该怎么出片"是两件不同的事，语义不通用，没有现成的桥，**不该为了"复用活着的东西"硬凑**（子牙在复审里也承认这是"倾向"不是唯一解）。

### 1.3 v2 的选择：重新点亮"确认出片"这个入口，不复活旧渲染逻辑

`content_posts` 表（[`supabase/migrations/20260425000001_magic_engine_foundation.sql:82-104`](../../supabase/migrations/20260425000001_magic_engine_foundation.sql)）本身没有退役——`title`/`script`/`caption`/`visual_brief`/`source_video_url` 都还在，退役的只是"确认之后自动出片"这一段。**Creatomate 天然适合接在这里**：它不需要分镜规划、不需要 i2v 逐帧生成、不需要配音——模板早就在编辑器里设计好了，代码只要把 `content_posts` 的字段填进模板占位符就行。所以 v2 **完全不碰** `render-pipeline.ts` / `render-assemble.ts` / `scripts/render-worker/`（继续保持死透，不删——沿用 2026-09-02 那次"先留仓库不删"的处置，本次也不改这个决定），Creatomate 路径是一条独立的新代码路径，不经过它们一步。

### 1.4 其余现状盘点（沿用 v1，本次未变）

| 检查项 | 结果 |
|---|---|
| `src/lib/creatomate/` 是否已存在 | 不存在，本次从零建 |
| `package.json` 是否已有相关依赖 | 无，纯 REST，不需要 SDK |
| 云端 Inngest 架构 | 双 app 隔离：云端 `magic-engine-web`（前缀 `cloud-`）vs 本机 worker `magic-engine-cts-workflow`，"一事件一主"，`WORKER_OWNED_EVENTS` 契约测试锁死（[`src/lib/inngest/client.ts:32-38`](../../src/lib/inngest/client.ts)）。**v2 新增事件名核对**：`me/factory.creatomate_render.*` 不在 `WORKER_OWNED_EVENTS` 名单里，本机 worker（`scripts/factory-worker/inngest-cts-workflow.mjs`/`inngest-pilot.mjs`）监听的都是精确字符串（`me/factory.cts-candidate.*`/`me/factory.pilot.*`），无通配符订阅——**不会撞车**（子牙 + 魏征交叉确认一致） |
| 云端 Inngest 函数范式 | fanout + 单客户处理两函数分离，回执落 `cronRunHandle`/`startCronRunId`（[`flywheel-seo-weekly.ts`](../../src/lib/inngest/functions/flywheel-seo-weekly.ts)）——v2 采用同一回执范式（§4.4） |
| `clients.factory_config` 结构 | 松散 jsonb，逐文件内联断言读取（[`render-pipeline.ts:26-32`](../../src/lib/factory/render-pipeline.ts) 的 `render.voice_id` 是同类先例）；**Settings UI 已有专门面板**（`src/app/dashboard/clients/[id]/settings/_components/FactoryConfigPanel.tsx`），本次新增的 `render.creatomate.*` 字段需要跟着补进这个面板（CLAUDE.md 铁律 8 强制要求），不能只让人去 Supabase 直填 |
| MTC 配额闸参考实现 | `src/lib/mtc/budget-guard.ts`，本次不接线，只留字段 |

**前情 4 个 PR 实际做了什么**（v1 已澄清，v2 不变）：#1351 写"做模板前先查爆款配方"规则；#1360 抽出 `imageToClip()` 并修正 Muapi 单价；#1367 写"分镜自检表"规则；#1373 两个纯函数（尚未接进任何 live 管线，无论新旧）；#1396 登记配额闸候选，依赖本 spec 落地。

---

## 2. Tier 判定（不变，复审未提出异议）

**建议层级**：L3 Connector。判据：Act（提交渲染）+ Read（查状态）+ Listen（webhook）三项齐全，provider 逻辑封在 adapter 内。不登记 `platform-candidates.md`。

红线 2 复核（三方都单独查过）：连接器代码本身不含客户名/ID；**唯一风险点是"怎么判断某个 modification key 是音频、需要一起给 duration"**——v1 没交代判断依据，魏征指出这里容易在实现时不知不觉把某客户模板的具体 key 名字焊进共享代码。v2 修法见 §4.7：判断依据来自 `factory_config` 里客户自己声明的 `audio_keys` 列表，连接器只做"你声明了就校验"，不猜测、不硬编码。

---

## 3. Creatomate API 实测摘录（不变，v2 修正了一处取整计算）

来源：[creatomate.com/llms/api.md](https://creatomate.com/llms/api.md)、[creatomate.com/llms/quick-start.md](https://creatomate.com/llms/quick-start.md)、[creatomate.com/llms/credits.md](https://creatomate.com/llms/credits.md)

### 3.1 端点与认证

| 项目 | 值 |
|---|---|
| 认证 | `Authorization: Bearer <project API key>` |
| 提交渲染 | `POST https://api.creatomate.com/v2/renders`，body：`{ template_id, modifications, webhook_url? }` |
| 查询状态 | `GET https://api.creatomate.com/v2/renders/{id}` |
| 限流 | 约 30 请求 / 10 秒 / key |
| 错误格式 | 400/401/402/404 → `{ "hint": "...", "documentation": "..." }`；429 → 纯文本（解析代码要分支处理，不能假设都是 JSON） |
| 输出文件保留期 | 30 天后过期——拿到 `url` 必须立刻转存 |

### 3.2 渲染状态机

```
planned → waiting → transcribing → rendering → succeeded | failed | cancelled
```

### 3.3 Webhook（关键缺口，处理方式见 §6.1）

官方确认 `webhook_url` 放请求体里，完成后会 POST 过来。**官方文档没有**说明 payload 字段结构，也没有说明是否有签名验证机制。默认当作"无法验证来源"处理。

### 3.4 Credit 计费公式（v2 修正取整）

| 类型 | 公式 |
|---|---|
| 图片 | 固定 1 credit |
| 视频 | `⌈width × height × frame_rate × duration(秒) ÷ 100,000,000⌉`（**官方文档原文是"rounded up"，v1 直接抄了官方示例数字 37.3 忘了取整，v2 改正**） |
| 自动字幕 | 10 credits/分钟（仅当超过渲染本身成本时才计） |

例：1080×1920 @30fps、30 秒 → `1080×1920×30×30÷100,000,000 = 18.6624` → 取整 **19 credits**；60 秒 → `37.3248` → 取整 **38 credits**（官方文档自己举的"37.3 credits/分钟"例子本身没套用它自己的取整规则，属于官方文档的不自洽，v2 不再原样沿用）。

---

## 4. 架构设计（v2 核心重写）

### 4.1 定位

Creatomate 是"确认选题→自动出片"这条 2026-09-02 关掉的入口的**新引擎**，不是给旧表加一条并列的分支。只对 `factory_config.render.engine === 'creatomate'` 的客户生效；没配置的客户，"确认"按钮继续返回现在这句"需人工处理"，**不受影响、不强推**。

明确排除：不碰 `content_work_orders`（语义不通用，§1.2 已说明）；不碰 `render-assemble.ts`（ffmpeg 拼接）/`scripts/render-worker/`（继续保持死透）。

**v2 定稿修正**（起草过程中查到 window bda74d92 的立项记录 `project-creatomate-connector-b-min`，原文明写工作流要"编排 `imageToClip` + `shot-guards` + `creatomate`"——本节初稿曾漏掉这层，直接从 `content_posts` 字段跳到 Creatomate `modifications`，会漏掉 PM 模板里需要的动态画面镜头）：Creatomate **不**取代分镜/画面生成这一层，只取代 `render-assemble.ts` 的 ffmpeg 拼接这一层。分镜规划（`planScenes()`）、画面生成（`generateImage()`+`uploadFromBase64()`）、i2v（`imageToClip()`）、配音（`generateVoiceover()`）——这四个都是 `render-pipeline.ts`/`broll-clip.ts` 里现成的**无状态可调用函数**，不依赖已死的 worker 或 `content_factory_render_jobs` 状态机，直接复用，不重写。**新增的唯一逻辑**是用 `classifyRenderMode()`（PR #1373 已写好、至今没有任何管线调用过的闸）决定每个镜头走 i2v 还是真实像素——这也顺带把 #1373 留下的"有闸没接线"缺口填上了。详细编排见 §4.3a。

### 4.2 状态机

复用 `content_factory_render_jobs` 现有 `status` 枚举，但因为跳过了"分镜规划"，只用其中四个：

```
queued → rendering（Creatomate 处理中，含 planned/waiting/transcribing/rendering 四个 provider 子状态）
       → assembling（下载产物 + 转存 Supabase Storage）
       → ready_for_review | failed
```

### 4.3 目录结构（L3 Connector）

```
src/lib/creatomate/
  client.ts     — 认证 fetch 封装：Bearer header、429 纯文本 vs 4xx JSON hint 分支解析、内部退避重试（429/5xx 各 3 次，2s/8s/20s）
  types.ts      — CreateRenderParams / RenderStatus / RenderResult
  render.ts     — submitRender()（幂等：先查 job 是否已有 creatomate_render_id）/ getRender() / pollUntilTerminal()
  cost.ts       — creditsForVideo()（§3.4 公式的唯一实现处，Math.ceil，禁止别处重算）/ creditsToUsd()
  modifications.ts — buildModifications(preparedScenes, factoryConfig) → 按 factory_config.render.creatomate.field_map 把 §4.3a 的镜头结果映射成 Creatomate modifications
  scene-assets.ts  — prepareSceneAssets()（§4.3a，编排 planScenes/generateImage/classifyRenderMode/imageToClip/generateVoiceover，全部复用既有函数）
  __tests__/
```

**不改动** `render-pipeline.ts`（不调用这个文件本身，避开魏征指出的"状态映射跟它实际行为对不上"问题）——但**复用它内部用到的独立函数**，见 §4.3a。

### 4.3a 场景素材准备（新增，衔接 §4.1 的定稿修正）

`src/lib/creatomate/scene-assets.ts::prepareSceneAssets({clientId, title, script}): Promise<PreparedScene[]>`——不是新逻辑，是把已有函数按新顺序编排一次：

1. `planScenes({clientId, title, script})`（`scene-plan.ts`，原样复用）→ 4-6 个镜头，每个带 `imagePrompt`/`motionPrompt`/`voText`/`captionText`
2. 每个镜头并行：
   - `generateImage({prompt: imagePrompt, aspect_ratio:'9:16'})` + `uploadFromBase64()`（`broll-clip.ts` 内部用的同一对函数，直接 import，不是新写）→ 拿到静态首帧图
   - `classifyRenderMode(imagePrompt)`（`shot-guards.ts`，PR #1373 已合、至今零调用方）→ `real_pixel` 就到此为止用静态图；`i2v` 才继续下一步
   - `i2v` 分支：`imageToClip({clientId, imageUrl, motionPrompt})`（`broll-clip.ts`，PR #1360）→ 拿到运镜后的 clip
   - `generateVoiceover({clientId, text: voText, voiceId, folder})`（原样复用，`voiceId` 读 `factory_config.render.voice_id`，跟 ffmpeg 路径共用同一个客户配置字段，不重复定义）
3. 返回每个镜头：`{index, captionText, visualUrl, visualType: 'image'|'video', voUrl}`——这份结构就是 §4.7 `field_map` 要映射进 Creatomate `modifications` 的数据源

**这一步本身也花钱**（gpt-image 出图 + i2v 视 `classifyRenderMode` 结果按需触发 + 配音），跟 §4.4 的 Creatomate 提交是**两笔独立的外部花费**，各自需要独立的幂等/不重试处理（不能因为 Creatomate 那步的 `retries:0` 就以为这一步也天然安全）——具体落进 §4.4 的 step 拆分。

### 4.4 Inngest 工作流（每个副作用独立 step，付费步骤禁止默认重试）

1. `[id]/route.ts` 的"确认"分支：若 `factory_config.render.engine === 'creatomate'`，恢复调用 `enqueueRenderJob()`（这个函数本身没退役，一直能用，只是没人调），发 Inngest 事件 `me/factory.creatomate_render.requested`（`{ jobId, clientId, postId }`，snake_case 字段名对齐仓库既有事件 payload 惯例）
2. 云端函数 `cloud-factory-creatomate-render`（`concurrency: { limit: 3, key: 'event.data.client_id' }`，对齐 `flywheel-seo-weekly.ts` 已有写法，防止同客户并发出片打爆限流）：
   - **step "check-existing"**（可重试）：读 job 行。若已有 `creatomate_render_id`，跳过下面两步，直接进入确认分支——防止"提交"和"落库"分离后，函数重放时误判"还没提交过"
   - **step "prepare-assets"**（`retries: 0`，不可重试——§4.3a 这一步花的是 gpt-image/Muapi 的真钱，若已有 `scenes` 落库同样先查后做，跟"submit"同一条纪律）：调用 `prepareSceneAssets()`（§4.3a），把结果落 job 行的 `scenes` 列（复用 `content_factory_render_jobs.scenes` jsonb 现有列，不新建列）
   - **step "submit"**（`retries: 0`，不可重试）：`buildModifications()` 按 §4.7 的 `field_map` 把上一步的 `scenes` 结果组装成 Creatomate `modifications`，`submitRender()` 提交，拿到 `render_id`
   - **step "persist-render-id"**（可重试，纯写库幂等）：把 `render_id` 写进 job 行的 `creatomate_render_id`
   - `step.waitForEvent('me/factory.creatomate_render.webhook_received', { match: 'data.job_id', timeout: '15m' })`——**webhook 事件本身只携带 `job_id` 和 `render_id`，不携带 `status`/`url`**（类型层面就不给，杜绝"webhook 说成功就直接采信"这条路，见 §6.1）
   - 不管是被 webhook 唤醒还是等满 15 分钟超时，**下一步永远是** `step.run` 独立调 `GET /v2/renders/{id}` 拿真实状态——webhook 只负责"提前戳一下，别等满 15 分钟"，从不负责"这就是结果"
   - 若这次查询仍非终态（还在 provider 队列里排着）：进入有限次数轮询（每 2 分钟一次，最多再等 20 分钟 = 10 次），仍未到终态 → 标 `failed`，`error` 写"Creatomate 渲染超时未完成"，**同时转一条今日待办**（连接 `src/lib/pm-todo/manual-items.ts` 既有的"需要你动手"栏，带 client_id/postId/creatomate_render_id，FDE 可以直接去 Creatomate 后台查这条 render 到底卡在哪）——这是 v2 专门补的"卡死回收"，替代已经死透的 `reapStale()`
   - `succeeded`：下载 `url` 前先做域名白名单校验（只信任 `api.creatomate.com`/`cdn.creatomate.com`，参考 `src/lib/factory/safe-remote-fetch.ts` 已有的"逐跳校验、禁止自动跟随跳转"模式，同等级别复用，不是另起一套）→ 下载 → 转存 Supabase Storage `content-factory` bucket，路径 `${client_id}/creatomate/${jobId}.mp4`（跟 ffmpeg 路径的 `${client_id}/render/${jobId}/final.mp4` 分开前缀，一眼看出这条产物走的哪个引擎）→ patch job 到 `ready_for_review`，`content_posts.source_video_url` 一并写入
   - `failed`/`cancelled`：patch `failed`，`error` 写 Creatomate 的 `error_message`（若是 402 额度用完，见 §6.2，额外转今日待办，不能只安静标失败）
3. **回执**：复用 `cronRunHandle`/`startCronRunId`（`flywheel-seo-weekly.ts` 同款），落 `request_id`（Inngest event id）、`client_id`、`source_record_id`（job id）、`status`、`cost_usd`（§7 公式）、`no_publish: true`（连接器只产出素材，不碰任何对外发布授权，下游 `review_actions.ts` 才管发布）、`created_at`——**v2 不再说"job 行本身就够当回执"**（魏征指出 job 行是可覆盖的一行，重试一次上一次回执就没了），改用有独立历史的 `cron_run_logs`

### 4.5 Webhook 接收端点

`src/app/api/webhooks/creatomate/route.ts`：只解析出 `render_id`，反查哪个 job 在等这个 `render_id`（`creatomate_render_id` 建索引），发 Inngest 事件（只带 `job_id`+`render_id`，payload 里其他字段一律丢弃不转发）。不做任何业务判断——业务判断（真实状态是什么）永远交给 §4.4 的独立 `GET` 查询。

### 4.6 数据模型改动

```sql
ALTER TABLE content_factory_render_jobs
  ADD COLUMN render_engine text NOT NULL DEFAULT 'ffmpeg'
    CHECK (render_engine IN ('ffmpeg', 'creatomate')),
  ADD COLUMN creatomate_render_id text;

CREATE INDEX IF NOT EXISTS idx_cfrj_creatomate_render_id
  ON content_factory_render_jobs (creatomate_render_id)
  WHERE creatomate_render_id IS NOT NULL;
```

风险：机械层面低（加列带默认值、带 CHECK、向后兼容），但**这条 PR 会命中 `docs/ENGINEERING_QUALITY_GATES.md` 受保护路径清单三项**（migration / `src/app/api/webhooks/` / 花费 guardrail），按该文档规则自报级别只是下限，**最终按 A 级验证强度走**（§8 显式标注，v1 漏标这条，魏征指出）。

### 4.7 客户配置结构（新增，红线 2 落点）

```jsonc
// clients.factory_config.render.creatomate
{
  "template_id": "xxx",
  "field_map": { "title": "Title-1", "visual_brief": "Background-1" },
  "audio_keys": ["Music-1"]  // 这个模板里哪些 key 是音频，提交前连接器会强制要求这些 key 一起传 duration，缺了直接拒绝提交，不静默放行（对应 §5 坑 #2）
}
```

`buildModifications()` 只做"按声明取值、按声明校验"，不认识任何具体客户的模板结构——同一份代码，换客户只是换一份 `factory_config`，符合红线 4 换客户测试。**Settings UI（`FactoryConfigPanel.tsx`）需要跟着补这三个字段的编辑控件**，不能让 FDE 去 Supabase 直填（CLAUDE.md 铁律 8）。

---

## 5. 官方文档没写、PM 实测踩出来的 5 个坑（v2 微调 #2 的判断依据）

| # | 坑 | 责任范围 | v2 处理 |
|---|---|---|---|
| 1 | 动画 `"time":"end"` 静默消失 | 模板结构（编辑器） | 连接器管不到，进模板设计检查清单 |
| 2 | audio 缺 `duration` 撑爆全片 | **连接器代码** | `submitRender()` 读 `factory_config.render.creatomate.audio_keys`（§4.7），这些 key 若没在 `modifications` 里同时给 `duration`，直接拒绝提交并报错，不静默放行 |
| 3 | image 只给 width 不给 height | 模板结构（编辑器） | 同 #1，进检查清单 |
| 4 | x_alignment/y_alignment 当定位 | 模板结构（编辑器） | 同上 |
| 5 | 同 track 号互相顶替 | 模板结构（编辑器） | 同上 |

渲染验证铁律不变：测试和上线前必须走一条真实 render 到拿到 `url` 打开验证，不能只信编辑器预览。**v2 额外补一条**：webhook 分支本地开发环境收不到公网回调（仓库没有 ngrok 之类的内网穿透先例），**webhook 分支只能在部署后用一条真实 render 验证一次**，本地测试只能验证轮询分支；这条必须写进上线验收清单，不能拿"轮询分支能跑"当成"webhook 分支也没问题"。

---

## 6. 未决问题

### 6.1 Webhook 安全（v2：已落实为具体设计，不再是"倾向方案"）

v1 只在文字上说"倾向方案 B"，但 §4.4 的步骤描述没有真正堵上——魏征指出如果 webhook 按时到达，流程会直接采信。**v2 已经在 §4.4 把这一点写死进步骤本身**：webhook 事件类型上就不携带 `status`/`url`，不管走哪条分支，"是否成功"永远由独立的 `GET /v2/renders/{id}` 决定，webhook 只是"提前戳一下"的加速信号，物理上没有被误信的空间。下载产物前的域名白名单校验也写进了 §4.4。

### 6.2 超出 2,000 credits/月怎么办（v2：升级为 BLOCKER，接真实客户流量前必须解决）

官方文档没写超额行为（硬顶拒绝 or 继续计费）。v2 判断：**这不阻碍写代码**（§4.4 已经设计了 402 场景的处理：不重试、标 failed、转今日待办，不会因为不知道而死循环或裸奔扣钱），**但阻碍接真实客户流量**——上线前必须有人去 Creatomate 账单后台或联系官方客服确认真实规则，不然 `cost_usd` 记账在超额区间会失真，没人会发现。这是一条需要人去查一次的事实，不是技术判断，建议开工时下发一条待办（谁去查、查什么、查完写哪）。

### 6.3 首个试点客户

假设是 CTS（前情 4 个 PR 的实测场景）。`template_id` 用 PM 已经在编辑器里搭好的模板。若有变动不影响架构，只影响 `factory_config` 里填的值。

---

## 7. 成本测算（v2 修正取整）

Essential 档：**$54/月**（PM 确认已订阅），2,000 credits/月。均摊单价 $54÷2,000 = **$0.027/credit**。

| 场景 | credits（取整） | 均摊成本 | 月度容量上限 |
|---|---|---|---|
| 1080×1920 @30fps，30 秒 reel | 19 | ≈$0.51 | 2000÷19 ≈ **105 条/月** |
| 1080×1920 @30fps，60 秒 reel | 38 | ≈$1.03 | 2000÷38 ≈ **52 条/月** |

（v1 曾写 107/53，是抄官方文档未取整的示例数字算出来的，v2 按官方文档自己写的"rounded up"规则重算。）

**§4.3a 补上后，一条渲染的真实成本不止 Creatomate credits 一项**：还要加每个 i2v 镜头 $0.30/条（PR #1360 实测单价，只有 `classifyRenderMode` 判 `i2v` 的镜头才产生这笔）+ gpt-image 出图（每镜头一张首帧图，成本参考 `reference-ai-api-unit-costs-2026-08` 现有记录）+ 配音。一条 4-6 镜头的 reel，若全部走 i2v，Muapi 那部分就是 $1.2-1.8，比 Creatomate 本身的均摊成本（$0.5-1）还高——**Creatomate 从来不是这条链路唯一的花费大户，`cost_usd` 记账必须把两边都算进去**，不能只记 Creatomate 那一半。

---

## 8. 范围边界（PM 已拍板：做什么 / 不做什么）

**风险级别**：**A 级**（migration + 新对外 endpoint + 花费记账三项命中 `ENGINEERING_QUALITY_GATES.md` 受保护路径清单，按规则从下限判定，v1 漏标，v2 补上）——意味着落地 PR 需要强验证，子牙+魏征两审在实现完成后**再过一轮**（设计阶段这轮不算数，CLAUDE.md 铁律 4 要求"设计一次+实施完再审一次"）。

**做**：
1. `src/lib/creatomate/` L3 Connector（§4.3）
2. Inngest 工作流：提交（幂等+不重试）→ webhook 加速/轮询兜底双确认 → 域名校验+转存 → 落库+回执（§4.4-4.6）
3. `content_factory_render_jobs` 加两列 + CHECK 约束（§4.6）
4. 音频 duration 强制校验（§4.7/§5 坑#2，唯一进代码的坑）
5. 成本记账（§7 公式，只记不拦）
6. `[id]/route.ts` "确认"分支恢复出片能力，仅对配置了 `render.engine='creatomate'` 的客户生效
7. `FactoryConfigPanel.tsx` 补 Creatomate 模板配置控件（§4.7，CLAUDE.md 铁律 8 强制）

**不做（本轮明确排除）**：
1. quota 闸——`cost_usd` 字段留空挂点，不接线
2. 复活 ffmpeg 蒙太奇路径的自动 worker——那条路径继续保持死透，本次不管
3. `content_work_orders`（广告创意变体循环）的任何改动——语义不通用，本次不碰

**时间估算**：鲁班在 v1 设计（挂在既有分镜生成管线之后）下估了 6.5-8 个工作日，主要超支在"webhook+轮询双保险"这套本仓库云端第一次出现的新模式。v2 定稿版把分镜/i2v/配音这一层（§4.3a）按 window bda74d92 原立项要求加回来了（比最初"完全跳过"的中间版本多一块集成面，但全部是复用现成函数，不是新写生成逻辑），综合下来现实估计 **6-7.5 个工作日**，仍然比 PM 最初给的 4-5 天多，多出来的部分主要在 §4.4 工作流本身的设计验证，其次是 §4.3a 两笔独立花费（Creatomate + Muapi/gpt-image）各自的幂等处理。

---

## 9. 客户配置 Settings UI（v2 新增，回应铁律 8）

`FactoryConfigPanel.tsx` 需要新增一个"出片引擎"分区：引擎下拉（ffmpeg 蒙太奇 / Creatomate 模板，默认 ffmpeg 保持现状）；选 Creatomate 后展开 `template_id` 输入框 + `field_map`/`audio_keys` 的简单键值编辑器。这部分不算"后台选模板 UI"（§8 明确排除的那种客户自己挑模板的复杂界面）——这里只是把 §4.7 那份 jsonb 配置从"要 FDE 去 Supabase 直填"变成"有个像样的表单填"，是铁律 8 的最低要求，不是新功能。

---

## 10. v1 → v2 改动清单（对照三方复审逐条落实情况）

| 来源 | 问题 | v2 怎么改 |
|---|---|---|
| 子牙 ❌B1 | 接错管线（`content_factory_render_jobs` 早已退役，且驱动它的是 `render-worker` 不是 `factory-worker`） | §1.1-1.3 重写：不复活旧渲染逻辑，只重新点亮"确认出片"入口，Creatomate 独立于旧管线 |
| 子牙 ❌B2 / 鲁班 ❌1❌2 | 付费提交步骤没有防重复闸，可能被 Inngest 默认重试重复扣钱 | §4.4：submit 独立 `retries:0` step + 提交前查 `creatomate_render_id` 幂等检查 |
| 子牙 ❌B3 | webhook 匹配用的 jobId 无处可来，双保险的"快"那一半实际上死掉 | §4.5：webhook 端点反查 `creatomate_render_id → job`，事件里带 `job_id` |
| 子牙 ❌B4 | 卡死没有回收，唯一的回收器随退役管线一起没了 | §4.4：有限次数轮询兜底 + 超时转今日待办 |
| 子牙 ❌B5 / 鲁班 W（配置） | jsonb 直填撞铁律 8 | §9 新增 Settings UI 分区 |
| 子牙 W1 | 回执不够（缺 request_id/no_publish，job 行是可覆盖的一行） | §4.4：改用 `cron_run_logs` |
| 子牙 W2 | migration 风险该判 A 级，`render_engine` 没有 CHECK 约束 | §4.6 加 CHECK；§8 显式标 A 级 |
| 子牙 W3 | 音频 duration 校验不该把模板结构焊进共享代码 | §4.7：判断依据改成客户声明的 `audio_keys` |
| 子牙 W8 | "第三条渲染路径"站不住，应该换接入点不是换引擎 | §4.1：改为"重新点亮入口"而非"新增并列分支" |
| 鲁班 ⚠️3⚠️4 | 4-5 天不现实；webhook 分支本地测不了 | §8 时间估算更新；§5 补验收清单要求 |
| 鲁班 ✅ | dry_run 值得做 | 留待落地 PR：`submitRender({dryRun:true})` 直接跑 `cost.ts` 纯函数，不发请求（v2 未展开写，作为实现细节） |
| 魏征 ❌2 | §6.1 方案 B 字面没落实，webhook 到时会被直接采信；下载 URL 前无域名校验 | §4.4/§6.1：webhook 事件类型不带 status/url；下载前域名白名单 |
| 魏征 ❌3 | Essential 价格 $54 vs 仓库旧记录 $45 矛盾 | PM 确认 $54，[`platform-candidates.md`](../registry/platform-candidates.md) 已同步更正 |
| 魏征 ❌4 | §6.2 超额未知应升级为 BLOCKER | §6.2 升级，且 §4.4 已有 402 场景兜底设计 |
| 魏征 ⚠️1 | 取整计算错误，容量高估 | §3.4/§7 改用 `Math.ceil`，105/52 条 |
| 魏征 ⚠️4 | 未标 A/B/C 风险级别 | §8 补标 A 级 |
| 魏征 ⚠️5 | §4.2 状态映射跟 `render-pipeline.ts` 真实行为对不上 | §4.1：v2 不调用 `render-pipeline.ts`，问题不复存在 |

---

## Reuse Statement（v2）

- **复用了什么已有平台能力**：`content_factory_render_jobs` 表（不新建表）、`content_posts` 现有字段、`enqueueRenderJob()`（未改动，只是重新被调用）、`planScenes()`/`generateImage()`+`uploadFromBase64()`/`classifyRenderMode()`/`imageToClip()`/`generateVoiceover()`（§4.3a，全部原样复用，零新写生成逻辑，顺带把 PR #1373 的闸接上了第一个真实调用方）、Supabase Storage `content-factory` bucket、`src/lib/workflows/inngest-event.ts`、`flywheel-seo-weekly.ts` 的云端函数+回执范式、`src/lib/factory/safe-remote-fetch.ts` 的域名校验模式、`FactoryConfigPanel.tsx` 现有 Settings 面板、`src/lib/pm-todo/manual-items.ts` 的人工待办栏
- **真正 platform-shared**：`src/lib/creatomate/` 整个 L3 Connector；"确认出片"入口重新点亮这件事本身（不限于 Creatomate，未来任何引擎都能挂在同一个 `render_engine` 开关下）
- **industry-specific**：无
- **client-specific**：`factory_config.render.creatomate.{template_id, field_map, audio_keys}`；§6.3 的 CTS 试点假设
- **客户事实有没有进 shared runtime**：没有。唯一容易踩的点（音频 key 判断）已经在 v2 改成配置声明式（§4.7），不是代码里硬编码
- **学习升级**：memory `reference-creatomate-silent-failures` 的 5 坑分工判断（§5）建议回写进该条 memory；本次"接错管线"这次事故本身，建议追加一条 feedback 类 memory——审计现有管线时，光读代码逻辑不够，必须额外查这段代码有没有被下线的记录（部署配置 `render.yaml`、调用方是否清零），这条本次没有查、直接吃了亏
