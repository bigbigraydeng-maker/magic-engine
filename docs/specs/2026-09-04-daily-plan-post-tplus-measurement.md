# Facebook 帖子 T+4 / T+72 效果回流 — 设计 v2（无生产写入）

**状态**：设计与探针，**未合并、未上线、未建表、未发帖**。
**范围**：主应用 Inngest 云端消费者，监听 `daily_plan.post.published`，在发出后 4 小时与 72 小时各读一次赞/评论/分享，写回 flywheel 表。
**读令牌口径**：只用**当前存下来的 Page Token**，**不申请 `read_insights`**，**不触发客户重新授权**。
**耐久身份**：发布桥每条帖子的 `idempotency_key`。

**v2 变更**：把 v1 里塞在 §7 的所有「两套预案 / 未解风险 / TODO」全部提前落进设计。现在设计**不依赖预先探针成功**——它对 Meta 每一种回应都由构造正确。探针（§8）只作证据，不作前提。

---

## 0. 一句话

Inngest 云端函数听发布事件，睡到 T+4 醒一次、T+72 再醒一次，各调一次 `GET /{post_id}?fields=reactions.summary(true),comments.summary(true),shares`，按 Meta 返回归类处理，写进 `flywheel_metrics`。整套走**已有的**表、词条、helper。

**不需要新表、不需要新 metric_key、不需要新权限、不需要客户重连。**

---

## 1. 复用清单（Reuse First 硬闸）

| 需要的能力 | 已存在 | 位置 |
|---|---|---|
| 云端 Inngest 端点 + 生产 fail-closed 守卫 | ✅ | [src/app/api/inngest/route.ts](../../src/app/api/inngest/route.ts), [src/lib/inngest/serve-guard.ts](../../src/lib/inngest/serve-guard.ts) |
| 云端函数写法 + 命名规约（`cloud-` 前缀）| ✅ | [src/lib/inngest/functions/probe.ts](../../src/lib/inngest/functions/probe.ts) |
| 事件被"本机 worker"占用与否的名单 | ✅ | [src/lib/inngest/client.ts:32](../../src/lib/inngest/client.ts) `WORKER_OWNED_EVENTS` |
| 发布事件与 payload zod schema | ✅ | [src/lib/campaign/daily-plan-publish.ts](../../src/lib/campaign/daily-plan-publish.ts) `CampaignDailyPublishMetaSchema` |
| 存 Page Token | ✅ | [src/lib/meta/token-manager.ts](../../src/lib/meta/token-manager.ts) `getStoredPageToken(clientId, pageId)` |
| 记一条 flywheel 动作 | ✅ | [src/lib/flywheel/social-post-publish.ts](../../src/lib/flywheel/social-post-publish.ts) `logSocialPublishedAction(...)` |
| 存表：`flywheel_actions` / `flywheel_metrics` / `flywheel_outcomes` | ✅ | [supabase/migrations/20260517000001_flywheel_data_skeleton.sql](../../supabase/migrations/20260517000001_flywheel_data_skeleton.sql) |
| 词条：`social.publish_post` / `social.post.likes` / `social.post.comments` / `social.post.shares` | ✅ | [src/lib/flywheel/vocabulary.ts:317, 340-346](../../src/lib/flywheel/vocabulary.ts) |
| Meta 授权失效自动下发待办 | ✅ | Meta 授权体检（PR #1362） |

**新增只有：**一个云端函数、两条部分唯一索引、README 一段。

---

## 2. 事件契约（不改）

`daily_plan.post.published`（[daily-plan-publish.ts:24](../../src/lib/campaign/daily-plan-publish.ts)）。**已经在发**（见发布路由 `sendInngestEvent`）。**不在 WORKER_OWNED_EVENTS 里** — 云端可以干净接管，不会被本机 worker 抢走。

**每条帖子一个事件还是一个事件多条**：发布路由每条帖子发一次独立事件（一批 N 条 → N 个 `event_ids`）。所以消费者的形状是「一个事件对应一条帖子」——payload 的 `published[]` 长度必然为 1。设计里对 `published.length !== 1` 直接短路返回 `not_supported`，保证契约。

---

## 3. 消费者函数

### 3.1 骨架

```ts
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { DAILY_PLAN_POST_PUBLISHED_EVENT, CampaignDailyPublishMetaSchema } from '@/lib/campaign/daily-plan-publish'

export const dailyPlanPostTplus = inngest.createFunction(
  {
    id: `${CLOUD_FN_PREFIX}daily-plan-post-tplus-measurement`,
    name: 'Daily Plan Post: T+4 / T+72 engagement snapshot',
    idempotency: 'event.data.published[0].idempotency_key',   // 24h 内重放去重
    concurrency: { limit: 4, key: 'event.data.page_id' },     // 按主页限并发，别把某个主页打红
    retries: 3,                                                // 只对 transient 才让它到 3 次
  },
  { event: DAILY_PLAN_POST_PUBLISHED_EVENT },
  async ({ event, step }) => {
    const parsed = CampaignDailyPublishMetaSchema.safeParse(event.data)
    if (!parsed.success || parsed.data.status !== 'PUBLISHED') return { ok: false, reason: 'not_published' }
    if (parsed.data.published.length !== 1) return { ok: false, reason: 'multi_post_event_not_supported' }

    const post = parsed.data.published[0]
    const clientId = parsed.data.client_id
    const pageId   = parsed.data.page_id
    const publishedAt = new Date(post.published_at).getTime()

    // 1) 记一条发布动作（幂等）
    const actionId = await step.run('log-publish-action', () =>
      recordPublishAction({ clientId, postId: post.post_id, pageId,
                            publishedAt: post.published_at, idempotencyKey: post.idempotency_key })
    )

    // 2) 睡到 T+4，读一次
    await step.sleepUntil('wait-tplus-4h', new Date(publishedAt + 4 * 3600_000))
    await step.run('snapshot-tplus-4h', () =>
      snapshotPostEngagement({ clientId, postId: post.post_id, pageId,
                               ageHours: 4, actionId, idempotencyKey: post.idempotency_key })
    )

    // 3) 睡到 T+72，读一次
    await step.sleepUntil('wait-tplus-72h', new Date(publishedAt + 72 * 3600_000))
    await step.run('snapshot-tplus-72h', () =>
      snapshotPostEngagement({ clientId, postId: post.post_id, pageId,
                               ageHours: 72, actionId, idempotencyKey: post.idempotency_key })
    )

    return { ok: true, idempotency_key: post.idempotency_key }
  },
)
```

`step.sleepUntil` 是 Inngest 的**持久睡眠**：Render 进程重启、部署新版本、事件重放，睡眠状态都保住。`step.run` 包过的步骤成功结果被持久化，重试时**已成功的步骤不重跑**。这就是"幂等消费者"的实现骨。

### 3.2 Meta 读取 —— 每一种回应都归一类（由构造正确）

```ts
async function snapshotPostEngagement(args): Promise<'ok' | 'partial' | 'permanent_unmeasurable'> {
  const token = await getStoredPageToken(args.clientId, args.pageId)
  if (!token) {
    // 授权在 T+N 前被撤了。这不是这次测量能修的，交给 Meta 授权体检去下发待办；
    // 本次测量按「永久无法测」结账，不让 Inngest 无谓重试 3 轮。
    await writeUnmeasurable(args, 'token_revoked_before_measurement')
    return 'permanent_unmeasurable'
  }

  const url = `https://graph.facebook.com/v20.0/${encodeURIComponent(args.postId)}` +
              `?fields=reactions.summary(true).limit(0),comments.summary(true).limit(0),shares` +
              `&access_token=${encodeURIComponent(token)}`

  let body: Record<string, unknown> | null = null
  try {
    const res = await fetch(url)
    body = await res.json().catch(() => null)
    if (!body) {
      // 5xx + 无 JSON → transient
      if (res.status >= 500) throw new Error(`graph_5xx_${res.status}`)   // ← 让 Inngest 退避重试
      // 其它 HTTP 但没 JSON → 永久，走 unmeasurable
      await writeUnmeasurable(args, `http_${res.status}_no_body`); return 'permanent_unmeasurable'
    }
  } catch (e) {
    throw e   // ← 网络异常也 transient，走 Inngest 重试
  }

  // ── Meta 顶层错误 → 每一种独立分派 ──────────────────────────────────
  if (body.error && typeof body.error === 'object') {
    const err = body.error as { code?: number; error_subcode?: number; message?: string }
    const code = err.code

    // 永久失败：不重试，直接结账，不占 Inngest 重试位。
    if (code === 200 || code === 10) {   // 权限降级：交给 Meta 授权体检下发待办；本次结账
      await writeUnmeasurable(args, `permission_missing_${code}`); return 'permanent_unmeasurable'
    }
    if (code === 100 || code === 803) {  // 帖子被删（客户或 Meta 主动删）
      await writeUnmeasurable(args, `post_not_found_${code}`); return 'permanent_unmeasurable'
    }
    if (code === 190) {                  // 令牌整个坏了 —— 交给授权体检
      await writeUnmeasurable(args, 'token_invalid_190'); return 'permanent_unmeasurable'
    }

    // 临时失败：让 Inngest 重试（退避）
    if (code === 4 || code === 17 || code === 341) throw new Error(`rate_limited_${code}`)
    if (code && code >= 500) throw new Error(`graph_5xx_body_${code}`)

    // 未知错误码：**保守当永久**（fail-closed，不让未知错误灌进重试队列）
    await writeUnmeasurable(args, `unknown_error_${code ?? 'null'}_${err.message?.slice(0, 60)}`)
    return 'permanent_unmeasurable'
  }

  // ── 三个字段每个独立取，缺席不用 0 掉包 ─────────────────────────────
  const reactions = readTotalCount(body.reactions)             // number | null
  const comments  = readTotalCount(body.comments)              // number | null
  const shares    = readShareCount(body.shares)                // number | 'unshared' | null

  const sourceRef = {
    idempotency_key: args.idempotencyKey,
    post_id: args.postId,
    age_hours: args.ageHours,
    action_id: args.actionId,
    partial_reasons: [] as string[],
  }
  if (reactions === null) sourceRef.partial_reasons.push('reactions_field_absent')
  if (comments  === null) sourceRef.partial_reasons.push('comments_field_absent')
  if (shares    === null) sourceRef.partial_reasons.push('shares_field_absent')   // shares === 'unshared' 走 0，不算 partial

  // 缺席字段写 NULL，不写 0 —— 0 是「实测零次」，NULL 是「问不到」，两者绝不塌一起
  await writeMetric(args.clientId, 'social.post.likes',    reactions === null ? null : reactions, sourceRef)
  await writeMetric(args.clientId, 'social.post.comments', comments  === null ? null : comments,  sourceRef)
  await writeMetric(args.clientId, 'social.post.shares',   shares === 'unshared' ? 0 : shares,    sourceRef)

  return sourceRef.partial_reasons.length ? 'partial' : 'ok'
}
```

### 3.3 关键判据（这些细节就是 v1 → v2 修的 bug）

| 判据 | 为什么 |
|---|---|
| `code === 200/10` 走 `writeUnmeasurable` 而不是 `throw` | v1 把权限缺失也 throw 让 Inngest 重试 3 次 —— 权限不会自愈，浪费 API 配额；由 Meta 授权体检下发待办才是解 |
| `code === 100/803` 走 `writeUnmeasurable` | 帖子被删是永久事实，不能进死信队列 |
| `code === 190` 也走 `writeUnmeasurable` | 令牌整个坏了，让 Meta 授权体检管；重试 3 次没意义 |
| **未知错误码保守当永久** | 从来没见过的错误灌进 Inngest 重试队列会一直哑着，人也看不见。宁可结账让人去查 |
| `getStoredPageToken` 拿不到 → 直接结账 | v1 是 throw → 3 次重试，浪费；授权在 T+72 期间被撤是常态，直接标 `token_revoked_before_measurement` |
| `shares === undefined` → 记 0 | Meta 对没被分享过的帖子直接省略这个字段。这是「零次」，不是「读不到」，塌到 NULL 会让 flywheel 报「问不到」误导决策 |
| `reactions.summary` 缺 `total_count` → 记 NULL 且 `partial_reasons` 里记原因 | 字段级降级不能塌成 0，也不能失败整轮 |
| Inngest `concurrency` 按 `page_id` 分组 | 一个主页发一堆帖子时不会因限流互相拖累 |

### 3.4 表层幂等（一次迁移，两条部分唯一索引，**不新建表**）

`step.run` 的 Inngest 层幂等只在**同一次事件生命周期**里管用。跨事件（同一条帖子被重推、或 T+4/T+72 分别被人手动补跑）时靠**表层唯一约束**兜底：

```sql
-- 20260904000001_flywheel_idempotency_post_tplus.sql

CREATE UNIQUE INDEX IF NOT EXISTS flywheel_metrics_post_tplus_unique
ON flywheel_metrics (
  client_id,
  metric_key,
  (source_ref->>'idempotency_key'),
  (source_ref->>'age_hours')
)
WHERE source_ref->>'idempotency_key' IS NOT NULL
  AND source_ref->>'age_hours' IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS flywheel_actions_social_publish_unique
ON flywheel_actions (
  client_id,
  action_type,
  (payload->>'idempotency_key')
)
WHERE action_type = 'social.publish_post'
  AND payload->>'idempotency_key' IS NOT NULL;
```

`writeMetric` / `writeUnmeasurable` / `recordPublishAction` 全部走 `ON CONFLICT DO NOTHING`。部分索引 + `WHERE ... IS NOT NULL` 保证对其它 `metric_key` 零副作用。

`writeUnmeasurable` 也走 `flywheel_metrics`，metric_value 写 NULL，`source_ref.unmeasurable_reason` 存原因。这样"没有数据"这件事也有一行留痕，`Check` 段永远不是空白。

---

## 4. 一路读到 IMPACT 的账

| IMPACT 段 | 谁在做 | 证据表 |
|---|---|---|
| **Inspect** — 客户主页表现 | 已有 | `page_metrics` 等 |
| **Measure** — 6 支柱打分 | 已有 | `flywheel_metrics` |
| **Prescribe** — AI 出处方 | 已有 | `execution_items` |
| **Act** — 真发到 Facebook | ✅ 刚做完（PR #1342-#1353） | 发布路由 + 幂等键 |
| **Check** — T+4 / T+72 效果回流 | **本设计** | `flywheel_metrics` 每帖 3 行 × 2 龄期 = 6 行；无法测的写 NULL 但也占一行 |
| **Tune** — 回喂下一轮处方 | 已有 attribution job | `flywheel_outcomes` |

---

## 5. 文件改动清单

| 文件 | 动作 | 行数估 |
|---|---|---|
| `src/lib/inngest/functions/daily-plan-post-tplus.ts` | **新增**（含 fetch + 每错误码分派 + 三字段独立取 + writeUnmeasurable） | ~250 |
| `src/lib/inngest/functions/daily-plan-post-tplus-fetch.ts` | **新增**（`readTotalCount` / `readShareCount` / `classifyGraphError` 供直测） | ~80 |
| `src/lib/inngest/functions/index.ts` | 加一行到 `cloudFunctions` | +1 |
| `supabase/migrations/20260904000001_flywheel_idempotency_post_tplus.sql` | **新增**（两条 partial unique index） | ~15 |
| `src/lib/inngest/functions/__tests__/daily-plan-post-tplus.test.ts` | **新增**（含 fail-closed、幂等、每错误码分派、shares 缺席 vs 缺权限、令牌撤销、未知码保守） | ~350 |
| `docs/STATE.md` | 加一条 Inngest 云端函数 | +2 |

**不改**：发布路由、发布桥 lib、Meta 授权体检、`daily-plan-publish.ts` 事件契约、任何现有表结构（只加两条 partial index）。

---

## 6. 风险等级

**A 级**：碰真发帖的数据下游、需数据库迁移（虽然只是加索引）、跨消费者一致性、涉及外部 API 长期轮询。

按 [ENGINEERING_QUALITY_GATES.md] 走：强验证 + 子牙 + 魏征 + 面向 IMPACT 请板桥读文案。

---

## 7. 变异测试清单（上线前**必须全部被抓**）

| 变异 | 应挂的测试 |
|---|---|
| `code === 200` 改成 `throw` | permission_missing_permanent 测试 |
| `code === 100` 改成 `throw` | post_not_found_permanent 测试 |
| `shares === undefined` 塌成 `null` | shares_unshared_equals_zero 测试 |
| `reactions.summary` 缺 total_count 塌成 0 | field_absent_writes_null 测试 |
| 未知错误码走 `throw` 而不是结账 | unknown_code_conservative_permanent 测试 |
| 一条帖子的 idempotency_key 生成两条 metric 行 | table_level_unique_index 集成测试 |
| 睡眠时间被硬编码成 0 | sleep_until_correct_duration 测试 |
| concurrency key 从 page_id 改成全局 | concurrency_scoped_by_page 测试 |
| Page Token 拿不到时走 throw | token_missing_returns_unmeasurable_not_throw 测试 |

---

## 8. 探针（证据，不是前提）

`src/app/api/clients/[id]/post-metrics-probe/route.ts` — 只读探针路由。

- **不写库、不发帖、不改任何现有功能**
- 用当前存下来的 Page Token 对一条**已发出**的帖子读一次 `reactions.summary(true).limit(0)`、`comments.summary(true).limit(0)`、`shares`
- 每个字段独立报（`ok(N) / field_absent / unshared_zero`），顶层错误按 §3.2 那张表**同一套**分类
- 输出一个 `verdict`：`all_ok` / `shares_missing_ok` / `permission_downgrade` / `blocked` / `transient` / `token_missing` / `input_error`

**跟设计的关系**：设计里 §3.2 的每一条判据都不依赖探针结果——它对任何 Meta 回应都由构造正确。探针只是**证据**，用来在灰度前拿实数印证设计里假设的分类跟 Meta 现实一致。

用法：登录 `app.magicengine.com.au` 之后在浏览器地址栏访问 `/api/clients/<client_id>/post-metrics-probe?post_id=<post_id>`，看 JSON。

---

## 9. 上线前 checklist（不含在本设计范围内）

- [ ] 用探针路由至少跑一次真实 CTS 帖子，把结果对着 §3.2 的分类表核一遍
- [ ] Inngest Cloud 后台登记 App URL（`/api/inngest`）
- [ ] 子牙 + 魏征至少一轮设计审
- [ ] §7 变异测试全部被抓
- [ ] 灰度：先只对 CTS 一个客户开消费者（用 event.data.client_id 过滤或后台标志），跑一批完整周期后再放量

---

**下一步不由本设计决定**——它只回答"要动什么、每种情况怎么处理、有什么风险"。做不做、什么时候做，由你拍板。
