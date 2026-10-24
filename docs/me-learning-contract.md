# ME 学习功能实现契约 v1

- 状态：草案 v1（文档，不含任何代码或迁移执行）
- 日期：2026-10-24
- 权威任务说明：Issue #3088（挂在 #3087 下）；工作模式以 #3087 为准
- 写入者：Claude Code（本文档）；代码由 DeepSeek 写，Codex Astra 只审查
- 层级判定（平台层级门，Inline）：本契约属于既有「记忆 / 验证」平台基础设施（L1 既有能力的扩展），不新增能力线、不新增支柱；外部来源走既有 Connector；客户名与客户私有事实不进共享代码

> 读法：第 1 节说"现在是什么样"，第 2–5 节是契约本体，第 6 节是验收用例，第 7 节是给 DeepSeek 的 5 份 PR 指令（L1–L5），第 8 节是需要核对的风险。
> 本文所有 SQL / TypeScript 都是**规格**，不在生产库执行，不直接复制成未审代码。

---

## 0. 事实基线（对照当前文件，非转述）

| 事实 | 出处 |
|---|---|
| 线上 Agent 读记忆的唯一入口是 `formatMemoryForPrompt` | `src/lib/memory/format.ts:46` |
| 跨客户经验读自 `global_learned_lessons`，已有过滤：`is_active`、`confidence ≥ 0.6`、`contradicted_count ≤ confirmed_count` | `src/lib/memory/service.ts:139-212` |
| 经验的"脱敏闸"已存在：`checkShareable` / `assertShareable`，拦金额、客户名、人名、结果计数 | `src/lib/memory/lesson-shareability.ts:196,228` |
| 经验写入口已存在：`writeGlobalLesson`（带脱敏闸） | `src/lib/memory/write-lesson.ts:77` |
| 技能卡只被看板读取，Agent 不读 | `src/lib/skill-cards/load.ts`、`board.ts` |
| 技能点 9 种状态；`adopted` 必须有 `rule`；`tried_failed` 必须有 `handoff`+`note` | `src/lib/skill-cards/types.ts` |
| 周度汇总写 `"<isoWeek>::<clientId>"` 字符串进 `client_learned_preferences.extracted_from_id`，该列是 UUID | `learning-rollup.ts:214,338-339`；`20260610000001_phase23_memory_tables.sql:34` |
| `savePreference` 出错只 `console.error` 并返回 `null` | `service.ts:333-336` |
| 周度汇总的幂等查询也用同一个字符串去比 UUID 列，错误被忽略，等于"永远没做过" | `learning-rollup.ts:219-228` |
| 周度汇总调用方把 `null` 记为 `error` 字符串，但 cron 路由是否把 `errors>0` 变成失败状态需 L1 核实 | `learning-rollup.ts:352`；`api/cron/agent-learning-rollup/route.ts` |
| 6 个支柱 key：`ads / seo / social / reputation / ai_visibility / competitor` | `src/lib/skill-cards/pillars.ts` |
| 技能卡目录 `docs/skill-cards/`，当前 27 张 | `load.ts:6` |

**⚠️ 一个必须先核对的事实**：仓库 `supabase/migrations/` 里**搜不到** `global_learned_lessons` 的建表语句（只在 `docs/` 里被提到）。说明这张表可能是手工建的、或由别处建的。L2 迁移必须用 `ADD COLUMN IF NOT EXISTS`，并在 PR 里附"生产表实际列"的只读核对结果（需 Ray 授权读生产结构，见第 8 节）。

---

## 1. 总体设计（一页）

```
来源(sources) ──采集──▶ 条目(items) ──提炼──▶ Markdown 技能卡(人审，正本)
                                                   │ sync-cards（解析现有 parser）
                                                   ▼
                                       技能点快照(points) + 状态流水(point_events, 只追加)
                                                   │ adopted 且通过脱敏闸、未过期
                                                   ▼
                                  global_learned_lessons（加列，不新建知识表）
                                                   │ loadGlobalLessons（加有效期/退役过滤）
                                                   ▼
                                  formatMemoryForPrompt（渲染带来源卡 + 有效期）
                                                   ▼
                                    华佗 / 诸葛 / 鲁班 / 张骞 / AI 工厂
   ▲                                                                   │
   └──── 投放结果 Verification（confirmed / reversed）回写 point_events ◀┘
```

原则：

1. **Markdown 技能卡仍是人工审核过的正本**；数据库里的 points / events 是它的机器可读副本与历史，不是第二个正本。
2. **只有 `adopted` 且有 `rule` 的点才可能进提示词**；`verifying / pm_decision / learning` 永不注入。
3. **不新建知识表**：学会的规则落在既有 `global_learned_lessons`，复用既有读取、既有 `contradicted_count` 机制与既有脱敏闸。
4. **失败要显示**：所有新写入函数返回 `Result`（成功/失败+原因），不吞错；运行回执写 `agent_learning_runs`；看板失败标红，不显示 0。
5. **客户私有内容不进共享层**：本契约的所有新表都是平台级（无 `client_id`）。客户私有学习仍留在 `client_*` 四张表。

---

## 2. 表结构（A 级迁移，规格）

迁移文件名（L2 PR 里使用）：`supabase/migrations/<timestamp>_agent_learning_foundation.sql`。**写好即停，不执行；Ray 单独 go 后才可由有权限者执行。**

通用规则（来自 CLAUDE.md §7）：每张新表必须 `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY ... FOR ALL TO service_role USING (true)`，**必须带 `TO service_role`**；不得出现 `workspace_id` / `client_team` / `auth.uid()`。

### 2.1 `agent_learning_sources` — 学习来源

```sql
CREATE TABLE IF NOT EXISTS agent_learning_sources (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key           text NOT NULL UNIQUE,            -- 稳定标识，如 'rss:industry-feed-1'
  kind                 text NOT NULL CHECK (kind IN ('rss','web_page','video_transcript','manual_url','internal_outcomes')),
  pillar               text NOT NULL CHECK (pillar IN ('ads','seo','social','reputation','ai_visibility','competitor')),
  url                  text,
  cadence_hours        integer NOT NULL DEFAULT 168 CHECK (cadence_hours > 0),
  enabled              boolean NOT NULL DEFAULT true,
  last_fetched_at      timestamptz,
  last_status          text CHECK (last_status IN ('ok','failed','skipped')),
  last_error           text,
  consecutive_failures integer NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
```

### 2.2 `agent_learning_items` — 采集条目

```sql
CREATE TABLE IF NOT EXISTS agent_learning_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id     uuid NOT NULL REFERENCES agent_learning_sources(id),
  external_ref  text NOT NULL,                  -- 对方的文章 id / URL，用于去重
  content_hash  text NOT NULL,                  -- 规范化正文的 sha256
  title         text,
  published_at  timestamptz,
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  status        text NOT NULL DEFAULT 'new' CHECK (status IN ('new','extracted','discarded','failed')),
  drafted_card_id text,                         -- 提炼出的技能卡 id（文件名去掉 .md），未提炼为 NULL
  fail_reason   text,
  UNIQUE (source_id, external_ref),
  UNIQUE (source_id, content_hash)
);
```

不存原文全文（避免版权和体积问题）：只存 hash + 标题 + 链接；提炼用的原文在内存里流转。

### 2.3 `agent_learning_points` — 技能点快照

```sql
CREATE TABLE IF NOT EXISTS agent_learning_points (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  point_key          text NOT NULL UNIQUE,      -- '<card id>#<point key>'，与 SkillPoint.mergedInto 同格式
  card_id            text NOT NULL,
  pillar             text NOT NULL CHECK (pillar IN ('ads','seo','social','reputation','ai_visibility','competitor')),
  point_text         text NOT NULL,
  state              text NOT NULL CHECK (state IN ('learning','pm_decision','verifying','adopted','not_applicable','tried_failed','cannot_check','already_in_me','merged')),
  rule               text,
  handoff            text,
  note               text,
  merged_into        text,
  card_sha           text NOT NULL,             -- 同步时卡片文件的 git blob sha
  valid_until        timestamptz,               -- 仅 adopted 有意义；NULL = 尚未设定（视为不可注入，见 4.3）
  last_reviewed_at   timestamptz,
  confirmed_count    integer NOT NULL DEFAULT 0,
  contradicted_count integer NOT NULL DEFAULT 0,
  synced_at          timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_learning_points_state_idx ON agent_learning_points (pillar, state);
```

### 2.4 `agent_learning_point_events` — 状态流水（只追加，充当版本历史）

```sql
CREATE TABLE IF NOT EXISTS agent_learning_point_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  point_key    text NOT NULL,                   -- 不加外键：点被卡片删除后历史仍要保留
  event_type   text NOT NULL CHECK (event_type IN ('synced','state_changed','adopted','contradicted','confirmed','expired','renewed','retired','blocked_by_gate')),
  from_state   text,
  to_state     text,
  reason       text NOT NULL,                   -- 人话，一句
  evidence     jsonb NOT NULL DEFAULT '{}'::jsonb,  -- 只放 id / 指针，不放客户业务数字
  card_sha     text,
  actor        text NOT NULL,                   -- 'sync-cards' | 'verification' | 'expiry-sweep' | 'pm:<id>'
  request_id   text NOT NULL,                   -- 回执 id，与 runs / Inngest 事件对齐
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_learning_point_events_key_idx ON agent_learning_point_events (point_key, created_at DESC);
-- 只追加：禁止 UPDATE / DELETE（触发器写法由 L2 PR 给出，Astra 重点审）
```

### 2.5 `agent_learning_runs` — 运行回执

```sql
CREATE TABLE IF NOT EXISTS agent_learning_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_key       text NOT NULL UNIQUE,           -- 幂等键，如 'sync-cards:2026-W43' / 'ingest:<source_key>:<yyyymmddhh>'
  job           text NOT NULL CHECK (job IN ('ingest','extract','sync_cards','expiry_sweep','reconcile','eval','weekly_rollup')),
  status        text NOT NULL CHECK (status IN ('running','succeeded','failed','partial')),
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  counts        jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {processed, written, skipped, failed}
  error         text,                           -- status 为 failed/partial 时必填（CHECK 在 L2 里写）
  cost_usd      numeric(10,4) NOT NULL DEFAULT 0,
  no_publish    boolean NOT NULL DEFAULT true,  -- 本流程永不对外发布
  request_id    text NOT NULL
);
```

### 2.6 `global_learned_lessons` 加列（不新建知识表）

```sql
ALTER TABLE global_learned_lessons
  ADD COLUMN IF NOT EXISTS source_point_key   text,          -- '<card id>#<point key>'；手工写入的老行为 NULL
  ADD COLUMN IF NOT EXISTS source_card_id     text,
  ADD COLUMN IF NOT EXISTS pillar             text,
  ADD COLUMN IF NOT EXISTS valid_until        timestamptz,   -- NULL = 老行，不过期（向后兼容）；新同步行必填
  ADD COLUMN IF NOT EXISTS last_reviewed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS sanitized_at       timestamptz,   -- 通过脱敏闸的时间；同步行必填
  ADD COLUMN IF NOT EXISTS shareability_verdict jsonb,
  ADD COLUMN IF NOT EXISTS retired_at         timestamptz,
  ADD COLUMN IF NOT EXISTS retired_reason     text;
CREATE UNIQUE INDEX IF NOT EXISTS global_learned_lessons_source_point_uidx
  ON global_learned_lessons (source_point_key) WHERE source_point_key IS NOT NULL;
```

向后兼容约束：**所有老行 `valid_until / retired_at` 为 NULL，行为与今天完全一致**；新规则只对 `source_point_key IS NOT NULL` 的同步行生效（见 4.2）。

---

## 3. `src/lib/agent-learning/contracts.ts`（类型规格）

只含类型、常量、纯函数；**不 import supabase / inngest / 任何 SDK**，这样 L4、L5 可以只依赖它。

```ts
export const LEARNING_PILLARS = ['ads','seo','social','reputation','ai_visibility','competitor'] as const
export type LearningPillar = typeof LEARNING_PILLARS[number]

// 复用，不重新定义：PointState、SkillPoint 来自 '@/lib/skill-cards/types'
export type { PointState, SkillPoint } from '@/lib/skill-cards/types'

export type SourceKind = 'rss' | 'web_page' | 'video_transcript' | 'manual_url' | 'internal_outcomes'
export type RunJob = 'ingest' | 'extract' | 'sync_cards' | 'expiry_sweep' | 'reconcile' | 'eval' | 'weekly_rollup'
export type RunStatus = 'running' | 'succeeded' | 'failed' | 'partial'

/** 所有写入函数的统一返回：不许吞错，不许返回 null 表示失败 */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string; code: ResultErrorCode }
export type ResultErrorCode = 'db_error' | 'validation' | 'gate_blocked' | 'not_found' | 'conflict'

export interface LearningSource { id: string; sourceKey: string; kind: SourceKind; pillar: LearningPillar; url: string | null; cadenceHours: number; enabled: boolean; lastFetchedAt: string | null; lastStatus: 'ok'|'failed'|'skipped'|null; lastError: string|null; consecutiveFailures: number }
export interface LearningItem { id: string; sourceId: string; externalRef: string; contentHash: string; title: string|null; status: 'new'|'extracted'|'discarded'|'failed'; draftedCardId: string|null }
export interface PointSnapshot { pointKey: string; cardId: string; pillar: LearningPillar; text: string; state: PointState; rule: string|null; validUntil: string|null; confirmedCount: number; contradictedCount: number; cardSha: string }
export type PointEventType = 'synced'|'state_changed'|'adopted'|'contradicted'|'confirmed'|'expired'|'renewed'|'retired'|'blocked_by_gate'
export interface PointEvent { pointKey: string; eventType: PointEventType; fromState: PointState|null; toState: PointState|null; reason: string; evidence: Record<string, string|number|boolean|null>; cardSha: string|null; actor: string; requestId: string }
export interface RunReceipt { runKey: string; job: RunJob; status: RunStatus; counts: { processed: number; written: number; skipped: number; failed: number }; error: string|null; costUsd: number; noPublish: true; requestId: string }

/** 有效期默认值（天）。平台级默认，不含任何客户/行业语义；可被单点 valid_until 覆盖 */
export const DEFAULT_VALIDITY_DAYS: Record<LearningPillar, number> = { ads: 90, social: 90, seo: 180, reputation: 180, ai_visibility: 90, competitor: 60 }

/** 推翻阈值：contradicted ≥ OVERTURN_MIN 且 contradicted > confirmed 则退役 */
export const OVERTURN_MIN = 2

/** 选择哪些点允许进提示词（纯函数，L3 使用，L5 评测复用） */
export function isInjectable(p: PointSnapshot, now: Date): boolean

/** 提示词里展示的来源标签，如 'card:2026-10-18-meta-ads-… · valid to 2027-01-16' */
export function formatLessonProvenance(p: { sourceCardId: string; validUntil: string | null }): string
```

> `DEFAULT_VALIDITY_DAYS` 的天数是**初始建议值**，不是业务事实；L3 PR 描述要注明"可调、未经客户数据验证"，由 Ray 之后按实测调整。

### 事件名（Inngest，业务可读，共 7 个）

| 事件 | 触发时机 | 关键载荷 |
|---|---|---|
| `agent_learning.source.fetched` | 一个来源采集结束（成功或失败） | sourceKey, itemsNew, status, requestId |
| `agent_learning.item.extracted` | 一条条目提炼出技能卡草稿 | itemId, draftedCardId, parserPassed, costUsd |
| `agent_learning.point.synced` | 卡片同步到 points 表 | pointKey, fromState, toState, cardSha |
| `agent_learning.point.adopted` | 点被采纳且通过脱敏闸、写入 lessons | pointKey, lessonId, validUntil |
| `agent_learning.point.contradicted` | 投放验证结果推翻一个点 | pointKey, contradictedCount, confirmedCount |
| `agent_learning.point.expired` | 过期巡检把点撤出提示词 | pointKey, validUntil |
| `agent_learning.run.failed` | 任一 learning 任务失败/部分失败 | runKey, job, error |

每个事件的载荷都必须带机器可读回执字段：`requestId`、`status`、`noPublish: true`、`createdAt`；全局学习没有 `clientId`，字段写 `null`，不得伪造。

**人工审核只推进到下一事件，不等于发布授权**；本流程不触发任何发布/扣费/对客户可见的外发，所以不需要 provider receipt，但 `noPublish: true` 必须在回执里体现。

---

## 4. 接入 `formatMemoryForPrompt`

### 4.1 为什么走 `global_learned_lessons`

`MemoryContext.global_lessons` 已经被华佗、诸葛、鲁班、张骞、AI 工厂全部接入（`grep formatMemoryForPrompt` 可验）。复用它 = **不改任何一个 Agent 的调用点**。

### 4.2 数据流（L3 实现）

1. `sync-cards`：读 `docs/skill-cards/*.md`（用现有 `loadSkillCards`），逐点 upsert `agent_learning_points`，状态变化写一条 `point_events`。
2. 对 `state='adopted'` 且 `rule` 非空的点：
   - 跑 `checkShareable({lesson, rationale}, ctx)`（`ctx` 用 `loadShareabilityContext` 取客户名）。**不通过 → 不写 lessons**，写一条 `blocked_by_gate` 事件，任务回执 `partial`，并进入人工待办（what/how/href 三件套，沿用 `src/lib/pm-todo/manual-items.ts`）。
   - 通过 → 经 `writeGlobalLesson` upsert，`lesson_key = 'card:' + pointKey`，`scope` 默认 `'channel'`，`source = 'auto_extracted'`（沿用现有枚举，**不新增枚举值**），并填 `source_point_key / source_card_id / pillar / valid_until / sanitized_at / shareability_verdict`。
   - `valid_until = 同步时间 + DEFAULT_VALIDITY_DAYS[pillar]`；点已存在且卡片未变则**不续期**（避免无人复查却自动延寿）。
3. `lesson` 文本 = 点的 `rule`（人审过的规则句），`rationale` 只写"为什么"，**案例、数字、客户事实放 `evidence`（不进提示词）**。这是 `lesson-shareability.ts` 头注里的第 2 层契约。

### 4.3 `loadGlobalLessons` 增加的过滤（`service.ts` 内，仅此函数）

在现有过滤后追加（纯函数 `isLessonLive(lesson, now)`，放 `agent-learning/` 里，`service.ts` 只调用）：

```
live = is_active
   AND retired_at IS NULL
   AND ( source_point_key IS NULL                                  -- 老行：行为不变
         OR ( sanitized_at IS NOT NULL AND valid_until IS NOT NULL AND valid_until > now ) )
```

即：**同步行缺脱敏时间或缺有效期 → 一律不注入**（fail-closed）；老行保持原状。`contradicted_count <= confirmed_count` 的既有过滤保留。

### 4.4 `format.ts` 的改动（最小）

`GlobalLesson` 的 `Pick<>` 增加 `source_card_id`、`valid_until`（均可选）；渲染行在现有结尾追加来源标签，**没有这两个字段的老行输出与今天逐字符一致**：

```
  - [channel/ads] <lesson> — why: <rationale> (src: card:<card id> · valid to 2027-01-16)
```

不改标题、不改其它段、不改 `has_content` 语义。已有测试 `__tests__/format-global-lessons.test.ts` 必须原样通过。

### 4.5 推翻机制

- **输入**：flywheel 验证结果（`confirmed / reversed`）按 `action → point_key` 的映射回写。映射来源：动作的 `source_point_key`（若动作未带此字段，则 L3 不做映射、对应结果只记入 `runs.counts.skipped`，**不猜**）。
- **规则**：`reversed` → `contradicted_count+1`，写 `contradicted` 事件；`confirmed` → `confirmed_count+1`。当 `contradicted_count ≥ OVERTURN_MIN` 且 `> confirmed_count`：点转 `tried_failed` 的**建议**（不自动改卡片文件）、对应 lesson 置 `retired_at / retired_reason`、`is_active=false`、发 `agent_learning.point.contradicted`，并产生人工待办让 PM 复核卡片。
- 机器**不改 Markdown 正本**，只改库里副本；正本修改仍走人审 PR。
- 过期：`expiry-sweep`（L3 的定时任务）把 `valid_until < now` 的 lesson 置 `retired_reason='expired'`，写 `expired` 事件；复查通过（`renewed`）才续期，且必须有人工动作或新证据，不自动续命。

### 4.6 脱敏闸（两层，沿用既有契约）

1. 写入时：`checkShareable`（第 4.2 步）。
2. 读取时：4.3 的 `sanitized_at IS NOT NULL` 门（防止有人绕过同步函数手工插行）。
3. 免责：闸是助手不是保证；个案放 `evidence`，这条规矩写进 L3 的 PR 描述。

---

## 5. 通用约束（每个 PR 都适用）

- TypeScript strict、无 `any`、函数 < 50 行、文件 < 800 行；SDK 客户端在 handler 内初始化。
- 新代码放 `src/lib/agent-learning/`，路由放 `src/app/api/`；调度目录 `cron/dispatch/catalog.ts`、`render.yaml`、迁移文件、依赖只由 L2/L3 按分工修改，L4/L5 不碰。
- 新增 `/api/cron/*` 必须同 PR 加 `render.yaml` 条目；**当场试跑**（CLAUDE.md "当场试跑"）：用测试数据或 `dry_run`，PR 正文必须有「## 当场试跑」段；不能跑就写原因并开台账卡。
- 外部来源只复用已有封装（先查 `docs/STATE.md §5` / `ls src/lib | grep -i <provider>`）；不手写直调第三方 API。
- 客户名、客户 ID、行业判断不得写进 shared 代码；示例与测试数据一律"示例客户 A"。
- 每个 PR 描述：目的、对应 #3088 第几项、当前状态、测试结果、卡点、等谁决定（#3087 第二节格式）；末尾附 Reuse Statement。
- 验证按"命令 / 工作目录 / 退出码 / 摘要"如实记录；没跑就写"未运行"及原因。

---

## 6. 验收用例（统一用"示例客户 A"）

共用测试数据放 `src/lib/agent-learning/__fixtures__/`（L2 提供）：2 个示例来源、3 条示例条目、5 个示例技能点（各一种关键状态）、示例客户 A（industry 为泛称"示例行业"）。

| # | 场景 | 步骤 | 期望 |
|---|---|---|---|
| V1 | 周度汇总真的写入 | 示例客户 A 本周有 2 个 confirmed、1 个 reversed 的 outcome；跑 `runWeeklyLearningRollup` | `client_learned_preferences` 多一行；`extracted_from_id` 是合法 UUID；再跑一次不新增（幂等） |
| V2 | 写失败不再静默 | 让 `savePreference` 的插入返回错误（测试替身） | 返回 `{ok:false, code:'db_error'}`；周度汇总 `errors≥1`；cron 路由返回非 2xx 或回执 `status='partial'/'failed'`；日志与回执都有原因 |
| V3 | 采纳的点进提示词 | 一个 `adopted` 点（`rule` 写"示例规则"）已同步、`valid_until` 在未来 | `formatMemoryForPrompt` 输出含该规则与 `src: card:<id> · valid to <日期>` |
| V4 | 未采纳不进 | 同卡里 `verifying` / `learning` 点 | 输出里不含这些点的文本 |
| V5 | 过期撤出 | 把 `valid_until` 设成昨天，跑 `expiry-sweep`，再取 `loadMemoryForClient` | 输出不含该规则；有一条 `expired` 事件；lesson 有 `retired_reason='expired'` |
| V6 | 缺有效期 fail-closed | 手工插一行 `source_point_key` 非空但 `valid_until` 为 NULL | 不注入 |
| V7 | 缺脱敏时间 fail-closed | 同上但 `sanitized_at` 为 NULL | 不注入 |
| V8 | 脱敏闸拦截 | `adopted` 点的 `rule` 含"花了 $500"或示例客户 A 的名字 | 不写 lessons；有 `blocked_by_gate` 事件；runs 回执 `partial`；产生人工待办（what/how/href 齐全） |
| V9 | 推翻 | 对同一点记录 2 次 reversed、0 次 confirmed | `contradicted_count=2`；lesson `retired_at` 非空；提示词不再含；有 `contradicted` 事件和复核待办 |
| V10 | 不够推翻 | 1 次 reversed、0 次 confirmed | 不退役，计数+1 |
| V11 | 老行不变 | `source_point_key` 为 NULL 的既有 lesson | 输出与改动前逐字符一致（快照测试） |
| V12 | 事件流水只追加 | 尝试对 `point_events` 做 UPDATE/DELETE（迁移后的集成测试，在测试库，不在生产） | 被拒绝 |
| V13 | 看板失败标红 | 最近一次 run `status='failed'` | 总览/运行健康页显示红色失败与原因，不显示 0 |
| V14 | 6 支柱筛选 | 打开学习库，切换支柱 | 6 个支柱都可选，数据按 `pillar` 过滤 |
| V15 | 采集去重 | 同一来源同一条目抓两次 | `items` 只有一行；第二次回执 `skipped+1` |
| V16 | 起草卡可解析 | `extract` 产出的 Markdown 草稿 | 100% 通过现有 `parseSkillCard`（含状态必填字段规则） |

---

## 7. 给 DeepSeek 的 PR 指令（L1–L5）

通用开场：先读 `CLAUDE.md`、`AGENTS.md`、本契约；声明实际可用的读文件/执行命令工具；你是**该 PR 的唯一写入者**，只能改下列"允许修改"的文件；不提交到 main、不推送他人分支、不合并、不部署、不写生产库。Codex Astra 只审不写，审查意见由你统一落地。

### 排期与冲突关系总览

| PR | 前置 | 迁移 | 与 PR-T1 |
|---|---|---|---|
| L1 | 无 | 无 | 可能共享 `service.ts`（见 L1 末尾） |
| L2 | 契约 v1；Ray 批 A 级迁移 | 有（A 级，只写不跑） | 改记忆层表 → **必须在 PR-T1 之后** |
| L3 | L2 | 无新迁移 | 动 `service.ts`/`format.ts` → **PR-T1 之后** |
| L4 | L2（之前用 fixtures） | 无 | 无 |
| L5 | L2 的 `contracts.ts` | 无 | 无 |

---

### L1 — 修周度汇总和静默失败

**目的**：让 `agent-learning-rollup` 真的写入，并且失败时看得见。
**风险级别**：B（普通业务逻辑）；不碰表结构。
**前置**：先确认与 PR-T1 的文件清单（见末尾"冲突说明"）。

**根因（已核对）**：
1. `learning-rollup.ts:214` 的 `dedupKey` 是 `"<isoWeek>::<clientId>"` 字符串，却写进 UUID 列 `extracted_from_id`（`:338-339`），也用它做 UUID 列的等值查询（`:225`）。
2. `service.ts:333-336` 的 `savePreference` 吞错返回 `null`。
3. 幂等查询 `:219-228` 忽略 `error`。

**修法（无需迁移）**：
- 新增纯函数 `weeklyRollupId(isoWeek, clientId): string`，用**确定性 UUID（v5 风格：对 `"agent-learning-rollup:" + isoWeek + "::" + clientId` 做 sha1，按 RFC 4122 v5 填位）**，写入和查询都用它。放在 `src/lib/memory/rollup-id.ts`（新文件，`learning-rollup.ts` 引用）。
- 幂等查询必须检查 `error`，出错即返回该客户 `error`，不得当成"没做过"。
- 新增 `savePreferenceChecked(supabase, input): Promise<{ok:true; value:LearnedPreference} | {ok:false; error:string}>`（放在 `service.ts`，**紧挨 `savePreference`，不改其签名**，避免影响其它调用方）；`learning-rollup.ts` 改用它，并把具体错误写入 `RollupResult.error`。`savePreference` 保持原行为，但在函数注释里标注"吞错，新代码用 Checked 版"。
- 核实并修正 `api/cron/agent-learning-rollup/route.ts`：`errors > 0` 时必须反映为失败/部分失败状态（读代码确认现状，按现状改最小）。

**允许修改**：`src/lib/memory/learning-rollup.ts`、`src/lib/memory/rollup-id.ts`（新）、`src/lib/memory/service.ts`（仅 `savePreference` 附近新增函数）、`src/app/api/cron/agent-learning-rollup/route.ts`、对应 `__tests__`。
**不得修改**：其它 `service.ts` 函数、`types.ts`、`format.ts`、任何迁移、`catalog.ts`。

**接口**：`weeklyRollupId(isoWeek: string, clientId: string): string`（同输入同输出，且匹配 UUID 正则）；`savePreferenceChecked` 如上。

**验收**：V1、V2；另加单测：`weeklyRollupId` 确定性与格式、幂等查询出错时返回 error、`errors>0` 时路由状态非成功。命令：`npm test -- src/lib/memory src/app/api/cron/agent-learning-rollup`、`npm run type-check`。
**当场试跑**：用测试替身或 `dry_run` 跑一次完整链路，贴输出；**不得对生产库写**。如路由没有 `dry_run`，用测试数据库/替身并写明。

**冲突说明（L1 vs PR-T1）**：
- 我**未能读取 #3087 正文**（本环境对 `gh` 的 issue 读取需要额外授权），因此不能断言 PR-T1 的确切文件清单。按本 issue 的描述"PR-T1 也改 `client_decision_history` 和记忆层"，**最可能与 L1 重叠的文件是 `src/lib/memory/service.ts`（及其测试）**。
- L1 的设计已把对 `service.ts` 的改动收敛为"紧挨 `savePreference` 新增一个函数，不动现有函数"，即使 PR-T1 也改 `service.ts`（如决策历史相关函数），通常是**不同位置的文本合并**，不会语义冲突；但仍可能出现文本冲突。
- **结论与建议**：L1 不改表结构、不改 `types.ts`/`format.ts`，因此满足 issue 的"例外"前提的**前半**；后半（"确认不与 PR-T1 改同一批文件"）需要 Traning Day 对照 PR-T1 的实际文件清单确认。**如 PR-T1 确实改 `service.ts`，建议 L1 等 PR-T1 合并后基于最新 main 再做**（L1 很小，等待成本低）。

---

### L2 — 共享地基（A 级）

**目的**：落 5 张新表 + `global_learned_lessons` 加列 + `contracts.ts` + 共用测试数据。**不接任何运行逻辑。**
**风险级别**：A（migration）。需 子牙 + 魏征 两审；Codex Astra 复审；**迁移 PR 写好后单独拿 Ray 的 go 才可执行，执行也不由 DeepSeek 做**。
**前置**：PR-T1 已合并（它改记忆层）；契约 v1 获确认。

**允许修改**：
- 新增 `supabase/migrations/<timestamp>_agent_learning_foundation.sql`（按第 2 节；RLS 全部 `FOR ALL TO service_role USING (true)`；`point_events` 的只追加触发器；`runs.error` 的 CHECK）。
- 新增 `src/lib/agent-learning/contracts.ts`（按第 3 节）、`src/lib/agent-learning/__fixtures__/*`、`src/lib/agent-learning/__tests__/contracts.test.ts`。
- 事件名类型：在现有 Inngest 事件定义处登记 7 个 `agent_learning.*`（先 `grep -rn "createFunction\|EventSchemas\|ads-events" src/lib/inngest` 找到约定，**照现有写法**，不发明新机制）。
**不得修改**：任何运行时代码（`service.ts`、`format.ts`、cron、页面）。

**接口**：第 3 节全部导出；`isInjectable`、`formatLessonProvenance`、`isLessonLive` 三个纯函数在本 PR 就实现并单测（L3 才接线）。

**验收**：
- 迁移 SQL 通过语法审阅；每张新表有 RLS + `TO service_role`（写一个读迁移文本的单测或脚本断言：所有 `CREATE TABLE agent_learning_*` 后都有 `TO service_role`）。
- `ADD COLUMN IF NOT EXISTS`，不假定 `global_learned_lessons` 已由仓库迁移创建（见第 8 节风险 R1）。
- V6、V7、V11 的纯函数部分、V12 的 SQL 审阅。
- `npm test -- src/lib/agent-learning`、`npm run type-check`。
**当场试跑**：不适用（无运行逻辑），PR 写"未运行：仅类型与迁移规格"。迁移在测试库的演练需另行授权，**不得对生产库执行**。

---

### L3 — 学会的规则进提示词

**目的**：技能卡同步 → 脱敏 → lesson → 提示词；过期与推翻；失败显示。
**风险级别**：A（鉴权无关，但改 Agent 提示词的共享读路径，影响所有线上 Agent，且含不可逆的对外内容影响）→ 按 A 级：子牙 + 魏征 两审，注入前后快照对比。
**前置**：L2 已合并且迁移已由有权限者执行（或在测试库演练）；PR-T1 已合并。

**允许修改**：
- 新增 `src/lib/agent-learning/{repo.ts, sync-cards.ts, bridge.ts, staleness.ts, overturn.ts}`：
  - `repo.ts`：points / events / runs 的读写，全部返回 `Result<T>`。
  - `sync-cards.ts`：`syncSkillCards({ supabase, root, now, requestId, dryRun })`。
  - `bridge.ts`：`bridgeAdoptedPoints(...)`——跑 `checkShareable`、调用 `writeGlobalLesson`、写 `adopted` / `blocked_by_gate` 事件。
  - `staleness.ts`：`sweepExpired(...)`。
  - `overturn.ts`：`recordVerification({ pointKey, verdict })`。
- Inngest 编排外壳（照现有 functions 目录的写法）+ 新 cron 路由 `src/app/api/cron/agent-learning-sync/route.ts` + `render.yaml` 与 `src/lib/cron/dispatch/catalog.ts` 条目（**同一 PR**）。
- `src/lib/memory/service.ts`：**仅** `loadGlobalLessons` 内追加 `isLessonLive` 过滤。
- `src/lib/memory/format.ts`：按 4.4 追加来源标签；`src/lib/memory/types.ts`：`Pick<>` 增加可选字段。
- 对应 `__tests__`。
**不得修改**：其它 Agent 的调用点；`lesson-shareability.ts`（规则调整另开 PR）；Markdown 技能卡正本。

**接口**：见上；`syncSkillCards` 必须支持 `dryRun`（只算不写，返回将要产生的事件）。所有任务写 `agent_learning_runs` 回执并发对应事件。

**验收**：V3–V11；注入前后对"示例客户 A"各 Agent 的 `formatMemoryForPrompt` 做快照对比，老行逐字符一致。
**当场试跑（强制）**：`dry_run` 跑 `syncSkillCards` 读真实 `docs/skill-cards`，贴"点数、各状态计数、将产生的事件数、被脱敏闸拦下的点数"；确认"快照表行数 = 技能点数"（实际同步到测试库后）。`dryRun` 不写任何库。
**注意**：lessons 一旦写入线上库就会进提示词——**生产环境首次真实同步前，须 PM/Ray 看过 dry-run 输出并明确同意**（写在 PR 的"等谁决定"）。

---

### L4 — 学习库工作台

**目的**：把 `dashboard/learning` 做成能看、能追溯的工作台，覆盖全部 6 个支柱，失败标红。
**风险级别**：C/B（UI + 只读 API）；做网页界面，交付前必过 Impeccable 检查（CLAUDE.md §7），把检查前后数字写进 PR；首次下载检查程序属外网读取，需先获准。
**前置**：L2 的类型与 fixtures 即可开工；真实数据待 L3。

**允许修改**：`src/app/dashboard/learning/**`、新增 `src/app/api/admin/agent-learning/**`（仅管理员，沿用现有页面的管理员判定方式）、对应测试。
**不得修改**：`src/lib/agent-learning/` 的写入函数（只读调用 `repo.ts`；L3 未合并前用 fixtures 通过依赖注入读取）、`src/lib/skill-cards/pillars.ts` 以外的看板逻辑（如需支柱数据，复用 `PILLAR_NAMES`）。

**6 个页面**：总览（支柱计数、最近运行、失败红条）· 来源（新鲜度、连续失败）· 候选队列（`verifying/pm_decision` 点）· Agent 在用（对某客户实际读到哪些 lessons，带来源卡和有效期）· 历史（`point_events` 时间线）· 运行健康（`agent_learning_runs`）。

**验收**：V13、V14；接口测试覆盖空数据、失败数据、未授权访问（非管理员 403）；`status='failed'` 的 run 一定红色且显示原因，**不得显示 0 或空白代替失败**；"Agent 在用"页使用示例客户 A 的 fixture 验证。
**当场试跑**：用 `npm run dev` + fixtures 打开 6 个页面并截图/描述；Impeccable 检查前后数字。

---

### L5 — 采集、提炼、对账、评测（纯函数）

**目的**：把采集/提炼/对账/评测的逻辑写成可测的纯函数，由 L3 接进编排。
**风险级别**：B。
**前置**：L2 的 `contracts.ts`。

**允许修改**：`src/lib/agent-learning/{ingest,extract,reconcile,eval}/**` 与测试。
**约束**：**不 import supabase、不碰 Inngest、不碰数据库**；外部依赖（抓取、转写、LLM）全部以参数传入（接口类型在 `contracts.ts` 里补一个 `Deps` 类型，由 L5 PR 提议、L3 接线）；复用现有转写封装与行业媒体来源，**先 `ls src/lib | grep -i <provider>` 再写**；LLM 调用经现有封装，UI/报告里不出现真实供应商名。

**接口**：
- `ingest`：`normalizeItem(raw): { externalRef, contentHash, title, publishedAt }`、`dedupeItems(existing, incoming)`。
- `extract`：`draftSkillCard(input: { item, pillar }, deps): Promise<Result<{ markdown: string; cardId: string }>>`，产物必须能被 `parseSkillCard` 解析且**初始状态只能是 `learning`**（机器不得自行写 `adopted`）。
- `reconcile`：`reconcilePoint(candidate, existingPoints): { verdict: 'new'|'already_in_me'|'conflict'|'partial'; ruleIds: string[] }`——判冲突时必须带规则编号（匹配现有 `RULE_ID_RE`）。
- `eval`：`evaluateReconcile(cases, predictions): { accuracy; confusion; perCase }`；评测集用 2026-10-18 独立复核的 48 条判断（评测集文件位置由 Traning Day 指明；找不到则在 PR 里报告缺失，**不编造**）。

**验收**：V15、V16；起草卡 100% 通过 `parseSkillCard`；`reconcile` 在 48 条评测集上给出准确率与混淆矩阵并贴入 PR。
**当场试跑**：对 3 条真实链接各跑一次 `ingest→extract`（需 Ray 授权外网读取与成本上限；**未授权则用 fixtures 并写明**），记录每条成本与耗时。不写库、不发布。

---

## 8. 风险与待确认事项

| # | 风险 / 待确认 | 影响 | 谁来定 |
|---|---|---|---|
| R1 | `global_learned_lessons` 在仓库迁移里找不到建表语句 | L2 迁移若假定表存在、而某环境没有则失败；需要只读核对生产表的实际列 | Ray 授权一次只读结构核对 |
| R2 | 未能读取 #3087 正文，PR-T1 文件清单未知 | L1 与 PR-T1 是否共享 `service.ts` 只能推断（见 L1 末尾） | Traning Day 对照后确认 |
| R3 | 动作 → `source_point_key` 的映射目前不存在 | 推翻机制（4.5）在映射缺失时只能跳过并计数，不能猜 | L3 PR 评估是否需要在 flywheel 动作上带该字段（若要改 flywheel 表则另走 A 级，不在本契约内） |
| R4 | `DEFAULT_VALIDITY_DAYS` 是初始建议值 | 过短会让规则频繁失效，过长会让过时规则留在提示词里 | Ray 在 L3 合并后按实测调整 |
| R5 | `source='auto_extracted'` 复用现有枚举 | 若表有 CHECK 且不含该值则写入失败（`writeGlobalLesson` 现状已使用？L3 须核对） | L3 DeepSeek 先读 `write-lesson.ts` 再定，不新增枚举值 |
| R6 | 脱敏闸只是助手 | 可能漏过换说法的客户事实 | 契约第 2 层：案例放 `evidence`，不进 `lesson/rationale`；Astra 审查重点 |
| R7 | Gemini 配额（Ray 第 2 项）会限制 L5 起草/分析的成功率 | L5 当场试跑可能成功率偏低 | Ray 决定是否升档（花钱） |

---

## 9. Reuse Statement

- **复用的平台能力**：记忆层读写与注入链路（`loadMemoryForClient` / `formatMemoryForPrompt`）；`global_learned_lessons` 及其既有过滤；`lesson-shareability` 脱敏闸与 `writeGlobalLesson`；`skill-cards` 解析器与看板；Inngest 事件约定；`pm-todo/manual-items` 人工任务管道；台账。
- **新增且真正平台共享**：5 张 `agent_learning_*` 表、`contracts.ts`、7 个事件、`isInjectable / isLessonLive` 等纯函数、同步/过期/推翻流程。全部无 `client_id`、无行业语义。
- **行业特定**：无。支柱是 6 柱通用 key，有效期默认按支柱而非行业。行业差异将来进 Industry Playbook / Profile，不在本契约。
- **客户特定**：无。示例一律"示例客户 A"。客户私有学习仍在 `client_*` 四张表，本契约不触碰。
- **是否把客户名/ID/行业判断写进 shared runtime**：否。脱敏闸阻止客户名进入 lessons。
- **学习升级边界**：本契约只处理已经是"术"的、人审采纳的全局规则；任何客户私有学习升到全局，仍须走既有 `writeGlobalLesson` + 脱敏闸 + 证据，不自动升级。
- **换客户自检**：把示例客户 A 换成任何客户、再换成另一个行业，本契约的表、类型、流程、默认有效期都无需修改。

## 10. 变更记录

- v1（2026-10-24）：首版。依据 #3088 触发评论的 5 项要求撰写；未执行任何迁移、未改业务代码。
