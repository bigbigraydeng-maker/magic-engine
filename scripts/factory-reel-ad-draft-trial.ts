/**
 * 自动「从刚发布的 Reel 起草一条暂停的 Facebook 广告」—— 离线端到端彩排（2026-10-09）。
 *
 * 做什么：用**真的**编排核心 runFactoryReelAdDraft、**真的** createDraftForApproval、
 * **真的** createGraphGet / probeMetaToken、**真的** publishDraftPaused 与读回逻辑，
 * 把一整条链路跑一遍（认领意图 → 预检 → 建暂停对象 → 读回核对 → 收尾意图 → 生成待办）。
 * 不碰生产库、不碰真 Meta、不碰真令牌：
 *   - 数据库换成内存版 flywheel_actions 假表；
 *   - Meta Graph 换成替换 globalThis.fetch 的假实现（跑完在 finally 里还原）；
 *   - Supabase 用占位环境变量（只为让模块能加载）。
 *
 * 用法：
 *   npx tsx scripts/factory-reel-ad-draft-trial.ts
 * 退出码 0 = 全部断言成立；非 0 = 有一步没达到预期（输出里会写是哪一步）。
 */

// 占位值,仅为让 '@/lib/supabase' 能被加载(它只在导入时检查有没有这几个变量,不会真连)。
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:9'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'dry-run-placeholder'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'dry-run-placeholder'

const CLIENT_ID = '11111111-1111-4111-8111-111111111111'
const WORK_ORDER_ID = '22222222-2222-4222-8222-222222222222'
const REQUEST_ID = '33333333-3333-4333-8333-333333333333'
const PAGE_ID = '111111'
const VIDEO_ID = '222222'
const PUBLISHED_AT = '2026-10-09T01:00:00.000Z'
const PERMALINK = 'https://www.facebook.com/reel/222222/'
const CLOCK_MS = Date.parse('2026-10-09T02:00:00.000Z')

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

// ─── 内存版 flywheel_actions 假表 ────────────────────────────────────────────
//
// 支持被测代码用到的调用形状：
//   insert(row).select('id').single() / .maybeSingle()
//   select(cols).eq(...).eq(...).eq(...).maybeSingle()
//   select('payload').eq('id', id).maybeSingle()
//   update({payload}).eq('id', id).eq('payload->>status', s).select('id')
// 并模拟部分唯一索引 (client_id, action_type, payload.idempotency_key)：
// 重复时返回 { code: '23505' }。

interface LedgerPayload {
  idempotency_key?: string
  status?: string
  [k: string]: unknown
}

interface LedgerRow {
  id: string
  client_id: string
  action_type: string
  payload: LedgerPayload
}

interface FakeLedger {
  rows: LedgerRow[]
  client: unknown
  reset(): void
}

function makeFakeLedger(): FakeLedger {
  const rows: LedgerRow[] = []
  let nextId = 1

  const findUnique = (clientId: string, actionType: string, key: string): LedgerRow | undefined =>
    rows.find(
      (r) =>
        r.client_id === clientId &&
        r.action_type === actionType &&
        r.payload.idempotency_key === key,
    )

  const client = {
    from(_table: string) {
      return {
        insert(row: { client_id: string; action_type: string; payload: LedgerPayload }) {
          const key = row.payload.idempotency_key
          if (typeof key === 'string' && findUnique(row.client_id, row.action_type, key)) {
            return {
              select: () => ({
                single: async () => ({ data: null, error: { code: '23505', message: 'duplicate key' } }),
                maybeSingle: async () => ({ data: null, error: { code: '23505', message: 'duplicate key' } }),
              }),
            }
          }
          const created: LedgerRow = {
            id: `row-${nextId++}`,
            client_id: row.client_id,
            action_type: row.action_type,
            payload: row.payload,
          }
          rows.push(created)
          return {
            select: () => ({
              single: async () => ({ data: { id: created.id }, error: null }),
              maybeSingle: async () => ({ data: { id: created.id }, error: null }),
            }),
          }
        },
        select(_cols: string) {
          const filters: { col: string; val: string }[] = []
          const builder = {
            eq(col: string, val: string) {
              filters.push({ col, val })
              return builder
            },
            async maybeSingle() {
              const match = rows.find((r) =>
                filters.every((f) => {
                  if (f.col === 'id') return r.id === f.val
                  if (f.col === 'client_id') return r.client_id === f.val
                  if (f.col === 'action_type') return r.action_type === f.val
                  if (f.col === 'payload->>idempotency_key') {
                    return r.payload.idempotency_key === f.val
                  }
                  return false
                }),
              )
              if (!match) return { data: null, error: null }
              return {
                data: { id: match.id, client_id: match.client_id, payload: match.payload },
                error: null,
              }
            },
          }
          return builder
        },
        update(patch: { payload: LedgerPayload }) {
          const filters: { col: string; val: string }[] = []
          const builder = {
            eq(col: string, val: string) {
              filters.push({ col, val })
              return builder
            },
            async select(_cols: string) {
              const match = rows.find((r) =>
                filters.every((f) => {
                  if (f.col === 'id') return r.id === f.val
                  if (f.col === 'payload->>status') return r.payload.status === f.val
                  return false
                }),
              )
              if (!match) return { data: [], error: null }
              match.payload = patch.payload
              return { data: [{ id: match.id }], error: null }
            },
          }
          return builder
        },
      }
    },
  }

  return {
    rows,
    client,
    reset() {
      rows.length = 0
      nextId = 1
    },
  }
}

// ─── 假 Meta Graph（替换 globalThis.fetch）───────────────────────────────────

interface RecordedRequest {
  method: string
  path: string
  body: URLSearchParams | null
}

interface MetaFaults {
  campaignStatusOverride: string | null
  debugTokenValid: boolean
}

interface FakeMeta {
  requests: RecordedRequest[]
  faults: MetaFaults
  handler(input: string, init?: RequestInit): Response
  reset(): void
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function textResponse(status: number, body: string): Response {
  return new Response(body, { status })
}

function makeFakeMeta(): FakeMeta {
  const requests: RecordedRequest[] = []
  const faults: MetaFaults = { campaignStatusOverride: null, debugTokenValid: true }
  const posted = new Map<string, URLSearchParams>()

  const handler = (input: string, init?: RequestInit): Response => {
    const method = (init?.method ?? 'GET').toUpperCase()
    const url = new URL(input)
    const path = url.pathname.replace(/^\/v21\.0\//, '')
    const body =
      method === 'POST' && typeof init?.body === 'string'
        ? new URLSearchParams(init.body)
        : null
    requests.push({ method, path, body })

    if (method === 'POST') {
      if (path === 'act_555/campaigns') {
        posted.set('sim_camp_1', body ?? new URLSearchParams())
        return jsonResponse(200, { id: 'sim_camp_1' })
      }
      if (path === 'act_555/adsets') {
        posted.set('sim_adset_1', body ?? new URLSearchParams())
        return jsonResponse(200, { id: 'sim_adset_1' })
      }
      if (path === 'act_555/adcreatives') {
        posted.set('sim_creative_1', body ?? new URLSearchParams())
        return jsonResponse(200, { id: 'sim_creative_1' })
      }
      if (path === 'act_555/ads') {
        posted.set('sim_ad_1', body ?? new URLSearchParams())
        return jsonResponse(200, { id: 'sim_ad_1' })
      }
      // 更新（例如 status=PAUSED）
      posted.set(path, body ?? new URLSearchParams())
      return jsonResponse(200, { success: true })
    }

    // GET
    if (path === 'sim_camp_1') {
      const status =
        faults.campaignStatusOverride ??
        posted.get('sim_camp_1')?.get('status') ??
        'PAUSED'
      return jsonResponse(200, { status })
    }
    if (path === 'sim_adset_1') {
      const p = posted.get('sim_adset_1') ?? new URLSearchParams()
      const status = p.get('status') ?? 'PAUSED'
      const targetingRaw = p.get('targeting') ?? '{}'
      return jsonResponse(200, {
        id: 'sim_adset_1',
        name: p.get('name') ?? '',
        optimization_goal: p.get('optimization_goal') ?? '',
        destination_type: p.get('destination_type') ?? '',
        status,
        effective_status: status,
        campaign_id: 'sim_camp_1',
        targeting: JSON.parse(targetingRaw) as unknown,
      })
    }
    if (path === 'sim_adset_1/ads') {
      const p = posted.get('sim_ad_1') ?? new URLSearchParams()
      const creative = posted.get('sim_creative_1') ?? new URLSearchParams()
      return jsonResponse(200, {
        data: [
          {
            id: 'sim_ad_1',
            name: p.get('name') ?? '',
            status: p.get('status') ?? 'PAUSED',
            creative: {
              id: 'sim_creative_1',
              effective_object_story_id: creative.get('object_story_id') ?? '',
            },
          },
        ],
      })
    }
    if (path.startsWith(`${PAGE_ID}_`)) {
      return jsonResponse(200, { message: 'Explore the coast this summer' })
    }
    if (path === '111111/published_posts') {
      return jsonResponse(200, {
        data: [
          {
            id: '111111_999',
            created_time: '2026-10-09T01:00:00+0000',
            attachments: {
              data: [
                {
                  media_type: 'video',
                  target: { id: '222222' },
                  url: 'https://www.facebook.com/reel/222222/',
                },
              ],
            },
          },
        ],
      })
    }
    if (path === 'debug_token') {
      return jsonResponse(200, {
        data: {
          is_valid: faults.debugTokenValid,
          scopes: ['ads_management', 'pages_show_list'],
          expires_at: 0,
        },
      })
    }

    console.log(`⚠️  假 Meta 收到未预期的请求：${method} /${path}`)
    return textResponse(404, 'not found')
  }

  return {
    requests,
    faults,
    handler,
    reset() {
      requests.length = 0
      posted.clear()
      faults.campaignStatusOverride = null
      faults.debugTokenValid = true
    },
  }
}

// ─── 工单夹具（与 run.test.ts 同构）─────────────────────────────────────────

interface ChecklistItem {
  key: string
  judge: 'AUTO' | 'HUMAN'
  outcome: 'PASS'
  detail: string
  source_ref: string | null
}

function buildChecklist(keys: readonly string[], judge: 'AUTO' | 'HUMAN'): ChecklistItem[] {
  return keys.map((key) => ({
    key,
    judge,
    outcome: 'PASS',
    detail: 'ok',
    source_ref: judge === 'HUMAN' && key.startsWith('factual_claims') ? 'brief:master' : null,
  }))
}

// ─── 主流程 ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { runFactoryReelAdDraft } = await import('../src/lib/ads-strategy/factory-reel-draft/run')
  const { createDraftForApproval } = await import('../src/lib/ads-strategy/draft-and-gate')
  const { createGraphGet, probeMetaToken } = await import('../src/lib/ads-strategy/factory-reel-draft/graph-io')
  const { buildReelPublishedEvent } = await import('../src/lib/factory/publish/reel-published-event')
  const { REEL_AUTO_CHECK_KEYS, REEL_HUMAN_CHECK_KEYS } = await import('../src/lib/social/content-review')
  const { buildFactoryReelAdDraftItems } = await import('../src/lib/pm-todo/factory-reel-ad-draft-items')
  type RunDeps = import('../src/lib/ads-strategy/factory-reel-draft/run').RunDeps
  type FetchLike = import('../src/lib/ads-strategy/factory-reel-draft/graph-io').FetchLike
  type ReelWorkOrderRow = import('../src/lib/ads-strategy/factory-reel-draft/gates').ReelWorkOrderRow
  type FactoryReelAdDraftSnapshot = import('../src/lib/pm-todo/factory-reel-ad-draft-items').FactoryReelAdDraftSnapshot

  const ledger = makeFakeLedger()
  const meta = makeFakeMeta()
  const originalFetch = globalThis.fetch

  const fetchLike: FetchLike = (url, init) => fetch(url, init)

  const event = buildReelPublishedEvent({
    workOrderId: WORK_ORDER_ID,
    clientId: CLIENT_ID,
    pageId: PAGE_ID,
    videoId: VIDEO_ID,
    publishedAt: PUBLISHED_AT,
    requestId: REQUEST_ID,
    createdAt: PUBLISHED_AT,
  }).data

  const workOrderRow: ReelWorkOrderRow = {
    id: WORK_ORDER_ID,
    client_id: CLIENT_ID,
    status: 'published',
    brief: {
      angle: 'Sample angle',
      copy: {
        caption: 'Explore the coast this summer',
        endcard: { cta: 'Book now', url: 'https://example.test/tours', offer: ['From $1,000'] },
      },
    },
    output: {
      video_path: `renders/${CLIENT_ID}/${WORK_ORDER_ID}/final.mp4`,
      quality_checklist_auto: buildChecklist(REEL_AUTO_CHECK_KEYS, 'AUTO'),
      redline_hits: [],
    },
    review_ref: {
      approved_by: 'pm@example.test',
      checklist_human: buildChecklist(REEL_HUMAN_CHECK_KEYS, 'HUMAN'),
    },
    published_ref: {
      platform: 'facebook',
      page_id: PAGE_ID,
      video_id: VIDEO_ID,
      video_state: 'PUBLISHED',
      published_at: PUBLISHED_AT,
      permalink: '/reel/222222/',
    },
  }

  let clockMs = CLOCK_MS

  const buildDeps = (mode: 'on' | 'dry_run'): RunDeps => ({
    supabase: ledger.client as RunDeps['supabase'],
    nowMs: () => clockMs,
    loadConfig: async () => ({
      config: {
        mode,
        geoCountries: ['NZ'],
        geoCityKeys: [],
        ageMin: 25,
        ageMax: 65,
        dailyBudget: 20,
        durationDays: 7,
        maxAgeHours: 6,
        updatedBy: null,
        updatedAt: null,
      },
      effectiveMode: mode,
      source: 'row',
    }),
    loadWorkOrder: async () => ({ ok: true, row: workOrderRow }),
    loadRedlines: async () => [],
    loadClientMeta: async () => ({
      adAccountId: 'act_555',
      facebookPageId: PAGE_ID,
      country: 'NZ',
      industry: 'travel',
    }),
    isAdAccountRegistered: async () => true,
    resolveToken: async () => ({ token: 'SIM_TOKEN', source: 'client' }),
    probeToken: (t) => probeMetaToken(fetchLike, t),
    loadPageToken: async () => 'SIM_PAGE_TOKEN',
    graphGetWith: (t) => createGraphGet(fetchLike, t),
    createDraft: createDraftForApproval,
  })

  const postRequests = (): RecordedRequest[] => meta.requests.filter((r) => r.method === 'POST')
  const anyActive = (): boolean =>
    meta.requests.some((r) => r.body?.get('status') === 'ACTIVE')

  try {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      return meta.handler(url, init)
    }) as typeof fetch

    // ── 场景 1：dry_run ────────────────────────────────────────────────────
    console.log('\n═══ 场景 1：dry_run 模式（只预演，不动 Meta）═══')
    ledger.reset()
    meta.reset()
    clockMs = CLOCK_MS
    const run1 = await runFactoryReelAdDraft(buildDeps('dry_run'), event)
    console.log(JSON.stringify(run1))
    check('结果是 dry_run_ok', run1.status === 'dry_run_ok')
    check('Meta 上没有任何 POST（只读）', postRequests().length === 0, `POST=${postRequests().length}`)
    const row1 = ledger.rows[0]
    check('意图行收尾为 dry_run_ok', row1?.payload.status === 'dry_run_ok')
    const preview = row1?.payload.draft_preview as { postId?: string } | undefined
    check('draft_preview.postId = 111111_999', preview?.postId === '111111_999')

    // ── 场景 2：on（真正起草）─────────────────────────────────────────────
    console.log('\n═══ 场景 2：on 模式（真正起草暂停对象）═══')
    ledger.reset()
    meta.reset()
    clockMs = CLOCK_MS
    const run2 = await runFactoryReelAdDraft(buildDeps('on'), event)
    console.log(JSON.stringify(run2))
    check('结果是 drafted', run2.status === 'drafted')
    const posts2 = postRequests()
    const creation = posts2.filter((r) =>
      ['act_555/campaigns', 'act_555/adsets', 'act_555/adcreatives', 'act_555/ads'].includes(r.path),
    )
    check('恰好 4 个创建 POST', creation.length === 4, `creation=${creation.length}`)
    const campPost = creation.find((r) => r.path === 'act_555/campaigns')
    const adsetPost = creation.find((r) => r.path === 'act_555/adsets')
    const creativePost = creation.find((r) => r.path === 'act_555/adcreatives')
    const adPost = creation.find((r) => r.path === 'act_555/ads')
    check('campaign POST status=PAUSED', campPost?.body?.get('status') === 'PAUSED')
    check('adset POST status=PAUSED', adsetPost?.body?.get('status') === 'PAUSED')
    check('ad POST status=PAUSED', adPost?.body?.get('status') === 'PAUSED')
    check('creative POST 无 status 字段', creativePost?.body?.get('status') === null)
    check('creative POST object_story_id=111111_999', creativePost?.body?.get('object_story_id') === '111111_999')
    check('creative POST 无 object_story_spec', creativePost?.body?.get('object_story_spec') === null)
    check('campaign 名字以 [ME-DRAFT] 22222222 开头', (campPost?.body?.get('name') ?? '').startsWith('[ME-DRAFT] 22222222'))
    check('adset 名字以 [ME-DRAFT] 22222222 开头', (adsetPost?.body?.get('name') ?? '').startsWith('[ME-DRAFT] 22222222'))
    check('全程没有任何 POST 带 status=ACTIVE', !anyActive())
    const intentRow = ledger.rows.find((r) => r.action_type === 'ads.factory_reel_draft')
    check('意图行收尾为 drafted', intentRow?.payload.status === 'drafted')
    check('意图行 provider_impact=paused_objects_created', intentRow?.payload.provider_impact === 'paused_objects_created')
    check('意图行有 draft_action_id', typeof intentRow?.payload.draft_action_id === 'string')
    const adRow = ledger.rows.find((r) => r.action_type === 'ads.create_ad')
    check('ads.create_ad 行 payload.status=awaiting_approval', adRow?.payload.status === 'awaiting_approval')

    // 待办项
    const drafts = new Map<string, { id: string; payload: LedgerPayload }>()
    for (const r of ledger.rows) {
      if (r.action_type === 'ads.create_ad') drafts.set(r.id, { id: r.id, payload: r.payload })
    }
    const snapshot: FactoryReelAdDraftSnapshot = {
      intents: ledger.rows
        .filter((r) => r.action_type === 'ads.factory_reel_draft')
        .map((r) => ({
          id: r.id,
          client_id: r.client_id,
          created_at: new Date(CLOCK_MS).toISOString(),
          payload: { ...r.payload },
        })),
      drafts,
      permalinks: new Map<string, string>([[WORK_ORDER_ID, PERMALINK]]),
      clientCapsUsd: new Map<string, number>(),
      truncated: false,
    }
    const items = buildFactoryReelAdDraftItems(snapshot, () => '演练客户', new Date(CLOCK_MS))
    const awaiting = items.filter((i) => i.kind === 'factory_reel_ad_awaiting_approval')
    check('恰好 1 条 factory_reel_ad_awaiting_approval 待办', awaiting.length === 1, `count=${awaiting.length}`)
    const item = awaiting[0]
    check('待办 href 以 /dashboard/ad-approval 结尾', (item?.href ?? '').endsWith('/dashboard/ad-approval'))
    check('待办 what 含 permalink', (item?.what ?? '').includes(PERMALINK))
    check('待办 what 含「不在任何受众池」', (item?.what ?? '').includes('不在任何受众池'))
    if (item) {
      console.log(`   what: ${item.what}`)
      console.log(`   how : ${item.how}`)
      console.log(`   href: ${item.href}`)
    }

    // ── 场景 3：重放（不重置）─────────────────────────────────────────────
    console.log('\n═══ 场景 3：同一事件重放（不许重复建）═══')
    const beforePosts = postRequests().length
    const run3 = await runFactoryReelAdDraft(buildDeps('on'), event)
    console.log(JSON.stringify(run3))
    check('结果是 duplicate', run3.status === 'duplicate')
    check('没有新增 POST', postRequests().length === beforePosts)

    // ── 场景 4：读回发现 campaign 是 ACTIVE ───────────────────────────────
    console.log('\n═══ 场景 4：读回发现 campaign 仍是 ACTIVE → 阻断 ═══')
    ledger.reset()
    meta.reset()
    clockMs = CLOCK_MS
    meta.faults.campaignStatusOverride = 'ACTIVE'
    const run4 = await runFactoryReelAdDraft(buildDeps('on'), event)
    console.log(JSON.stringify(run4))
    check('结果是 draft_blocked', run4.status === 'draft_blocked')
    const pausePosts = postRequests().filter(
      (r) => ['sim_camp_1', 'sim_adset_1', 'sim_ad_1'].includes(r.path) && r.body?.get('status') === 'PAUSED',
    )
    check('发出了暂停更新 POST', pausePosts.length > 0, `pause=${pausePosts.length}`)
    const intentRow4 = ledger.rows.find((r) => r.action_type === 'ads.factory_reel_draft')
    check('意图行收尾为 draft_blocked', intentRow4?.payload.status === 'draft_blocked')

    // ── 场景 5：过期（发布 7 小时后）──────────────────────────────────────
    console.log('\n═══ 场景 5：发布 7 小时后才跑 → stale 阻断 ═══')
    ledger.reset()
    meta.reset()
    clockMs = Date.parse(PUBLISHED_AT) + 7 * 3600_000
    const run5 = await runFactoryReelAdDraft(buildDeps('on'), event)
    console.log(JSON.stringify(run5))
    check('结果是 blocked', run5.status === 'blocked')
    check('blockCode=stale', run5.blockCode === 'stale')
    check('闸门之后没有任何 Meta 请求', meta.requests.length === 0, `req=${meta.requests.length}`)
    const intentRow5 = ledger.rows.find((r) => r.action_type === 'ads.factory_reel_draft')
    check('意图行收尾为 blocked', intentRow5?.payload.status === 'blocked')

    // ── 场景 6：令牌失效 ──────────────────────────────────────────────────
    console.log('\n═══ 场景 6：debug_token 报 is_valid=false → token_dead ═══')
    ledger.reset()
    meta.reset()
    clockMs = CLOCK_MS
    meta.faults.debugTokenValid = false
    const run6 = await runFactoryReelAdDraft(buildDeps('on'), event)
    console.log(JSON.stringify(run6))
    check('结果是 blocked', run6.status === 'blocked')
    check('blockCode=token_dead', run6.blockCode === 'token_dead')
    check('没有任何 POST', postRequests().length === 0)
  } finally {
    globalThis.fetch = originalFetch
  }

  console.log(failures === 0 ? '\n全部通过 ✅' : `\n有 ${failures} 项没达到预期 ❌`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('彩排本身出错:', e)
  process.exit(2)
})
