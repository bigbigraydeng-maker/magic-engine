import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { REEL_HUMAN_CHECK_KEYS, REEL_AUTO_CHECK_KEYS } from '@/lib/social/content-review'
import type { IntentPayload } from '../intent-ledger'
import { NOT_PAUSED_MARKER } from '@/lib/pm-todo/factory-reel-ad-draft-items'
import type { ReelWorkOrderRow } from '../gates'
import type { LoadedFactoryReelDraftConfig } from '../config'
import type { PostResolverDeps, GraphGetResult } from '../post-resolver'
import type { AdDraft } from '../../ad-draft'
import type { CreateDraftOutcome } from '../../draft-and-gate'
import {
  runFactoryReelAdDraft,
  type RunDeps,
  type ClientMetaFacts,
} from '../run'

// ── 内存版 flywheel_actions 假表（形状照抄 intent-ledger.test.ref.ts） ────────

interface FakeRow {
  id: string
  client_id: string
  action_type: string
  payload: IntentPayload
}

interface FakeConfig {
  insertError?: { code?: string; message: string }
  forceUniqueViolationOnInsert?: boolean
  readBackError?: { message: string }
  readBackEmpty?: boolean
  updateError?: { message: string }
  updateMatchesZero?: boolean
}

interface FakeSupabase {
  client: SupabaseClient
  rows: FakeRow[]
  calls: { insert: number; select: number; update: number }
}

function makeFakeSupabase(config: FakeConfig = {}): FakeSupabase {
  const rows: FakeRow[] = []
  const calls = { insert: 0, select: 0, update: 0 }
  let nextId = 1

  const findUnique = (clientId: string, actionType: string, key: string): FakeRow | undefined =>
    rows.find(
      (r) =>
        r.client_id === clientId &&
        r.action_type === actionType &&
        r.payload.idempotency_key === key,
    )

  const client = {
    from(_table: string) {
      return {
        insert(row: { client_id: string; action_type: string; payload: IntentPayload }) {
          calls.insert += 1
          if (config.insertError) {
            return {
              select: () => ({
                single: async () => ({ data: null, error: config.insertError }),
              }),
            }
          }
          if (config.forceUniqueViolationOnInsert) {
            return {
              select: () => ({
                single: async () => ({
                  data: null,
                  error: { code: '23505', message: 'duplicate key' },
                }),
              }),
            }
          }
          const dup = findUnique(row.client_id, row.action_type, row.payload.idempotency_key)
          if (dup) {
            return {
              select: () => ({
                single: async () => ({
                  data: null,
                  error: { code: '23505', message: 'duplicate key' },
                }),
              }),
            }
          }
          const created: FakeRow = {
            id: `row-${nextId++}`,
            client_id: row.client_id,
            action_type: row.action_type,
            payload: row.payload,
          }
          rows.push(created)
          return {
            select: () => ({
              single: async () => ({ data: { id: created.id }, error: null }),
            }),
          }
        },
        select(_cols: string) {
          calls.select += 1
          const filters: { col: string; val: string }[] = []
          const builder = {
            eq(col: string, val: string) {
              filters.push({ col, val })
              return builder
            },
            async maybeSingle() {
              if (config.readBackError) return { data: null, error: config.readBackError }
              if (config.readBackEmpty) return { data: null, error: null }
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
        update(patch: { payload: IntentPayload }) {
          calls.update += 1
          const filters: { col: string; val: string }[] = []
          const builder = {
            eq(col: string, val: string) {
              filters.push({ col, val })
              return builder
            },
            async select(_cols: string) {
              if (config.updateError) return { data: null, error: config.updateError }
              if (config.updateMatchesZero) return { data: [], error: null }
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

  return { client: client as never, rows, calls }
}

// ── 事件 / 工单 / 配置 fixtures ─────────────────────────────────────────────

const CLIENT_ID = '11111111-1111-4111-8111-111111111111'
const WORK_ORDER_ID = '22222222-2222-4222-8222-222222222222'
const REQUEST_ID = '33333333-3333-4333-8333-333333333333'
const PUBLISHED_AT = '2026-10-09T01:00:00.000Z'
const NOW_MS = Date.parse('2026-10-09T02:00:00.000Z')

function makeEvent(): Record<string, unknown> {
  return {
    schema_version: 1,
    request_id: REQUEST_ID,
    work_order_id: WORK_ORDER_ID,
    client_id: CLIENT_ID,
    platform: 'facebook',
    page_id: '111111',
    video_id: '222222',
    post_id: '222222',
    media_type: 'reel',
    published_at: PUBLISHED_AT,
    status: 'PUBLISHED',
    no_publish: false, // 事件本身是「已发布」的既成事实
    authorization: 'AUTHORIZED',
    cost_usd: 0,
    created_at: PUBLISHED_AT,
  }
}

function makeWorkOrderRow(): ReelWorkOrderRow {
  return {
    id: WORK_ORDER_ID,
    client_id: CLIENT_ID,
    status: 'published',
    published_ref: {
      platform: 'facebook',
      page_id: '111111',
      video_id: '222222',
      video_state: 'PUBLISHED',
      published_at: PUBLISHED_AT,
    },
    review_ref: {
      approved_by: 'pm@example.test',
      checklist_human: REEL_HUMAN_CHECK_KEYS.map((key) => ({
        key,
        judge: 'HUMAN' as const,
        outcome: 'PASS' as const,
        detail: null,
        source_ref:
          key === 'factual_claims_have_source' || key === 'factual_claims_source_verified'
            ? 'https://example.test/s'
            : null,
      })),
    },
    output: {
      quality_checklist_auto: REEL_AUTO_CHECK_KEYS.map((key) => ({
        key,
        judge: 'AUTO' as const,
        outcome: 'PASS' as const,
        detail: null,
        source_ref: null,
      })),
      redline_hits: [],
    },
    brief: {
      copy: {
        caption: 'Explore the coast',
        endcard: { cta: 'Book now' },
      },
    },
  } satisfies ReelWorkOrderRow
}

function makeConfig(mode: 'dry_run' | 'on'): LoadedFactoryReelDraftConfig {
  return {
    config: {
      mode,
      geoCountries: ['US'],
      geoCityKeys: ['2420605'],
      ageMin: 25,
      ageMax: 55,
      dailyBudget: 20,
      durationDays: 7,
      maxAgeHours: 6,
      updatedBy: null,
      updatedAt: null,
    },
    effectiveMode: mode,
    source: 'row',
  }
}

const META: ClientMetaFacts = {
  adAccountId: 'act_123',
  facebookPageId: '111111',
  country: 'US',
  industry: 'travel',
}

/** 帖子解析器用的 graphGet 假实现：返回一个含目标帖子的 published_posts 响应。 */
function makeGraphGet(): PostResolverDeps['graphGet'] {
  return vi.fn(
    async (_path: string, _query: Record<string, string>): Promise<GraphGetResult> => ({
      ok: true,
      status: 200,
      body: {
        data: [
          {
            id: '111111_999',
            attachments: { data: [{ target: { id: '222222' } }] },
          },
        ],
      },
    }),
  )
}

interface HappyOpts {
  mode?: 'dry_run' | 'on'
  fake?: FakeSupabase
  createDraft?: RunDeps['createDraft']
  graphGet?: ReturnType<typeof makeGraphGet>
}

function happyDeps(opts: HappyOpts = {}): {
  deps: RunDeps
  fake: FakeSupabase
  graphGet: ReturnType<typeof makeGraphGet>
  createDraft: ReturnType<typeof vi.fn>
  capturedIntentStatus: { value: string | null }
} {
  const fake = opts.fake ?? makeFakeSupabase()
  const graphGet = opts.graphGet ?? makeGraphGet()
  const capturedIntentStatus: { value: string | null } = { value: null }
  const createDraft =
    opts.createDraft ??
    vi.fn(
      async (): Promise<CreateDraftOutcome> => {
        const row = fake.rows.find((r) => r.payload.work_order_id === WORK_ORDER_ID)
        capturedIntentStatus.value = row ? row.payload.status : null
        return {
          actionId: 'draft1',
          status: 'awaiting_approval',
          summary: 'ok',
          findings: [],
        }
      },
    )

  const deps: RunDeps = {
    supabase: fake.client,
    nowMs: () => NOW_MS,
    loadConfig: vi.fn(async () => makeConfig(opts.mode ?? 'on')),
    loadWorkOrder: vi.fn(async () => ({ ok: true as const, row: makeWorkOrderRow() })),
    loadRedlines: vi.fn(async () => [] as string[]),
    loadClientMeta: vi.fn(async () => META),
    isAdAccountRegistered: vi.fn(async () => true),
    resolveToken: vi.fn(async () => ({ token: 'tok-abc', source: 'client' })),
    probeToken: vi.fn(async () => ({ ok: true })),
    loadPageToken: vi.fn(async () => 'page-tok'),
    graphGetWith: vi.fn((_pageToken: string) => graphGet),
    createDraft: createDraft as RunDeps['createDraft'],
  }

  return {
    deps,
    fake,
    graphGet,
    createDraft: createDraft as ReturnType<typeof vi.fn>,
    capturedIntentStatus,
  }
}

// ── 测试 ────────────────────────────────────────────────────────────────────

describe('runFactoryReelAdDraft', () => {
  it('(1) invalid event => invalid_event, no ledger row, no deps called', async () => {
    const { deps, fake } = happyDeps()
    const res = await runFactoryReelAdDraft(deps, { nope: true })
    expect(res.status).toBe('invalid_event')
    expect(res.intentActionId).toBeNull()
    expect(fake.rows).toHaveLength(0)
    expect(deps.loadConfig).not.toHaveBeenCalled()
    expect(deps.loadWorkOrder).not.toHaveBeenCalled()
    expect(deps.createDraft).not.toHaveBeenCalled()
  })

  it('(2) effectiveMode off => skipped_off, no ledger row, loadWorkOrder not called', async () => {
    const { deps, fake } = happyDeps()
    deps.loadConfig = vi.fn(
      async (): Promise<LoadedFactoryReelDraftConfig> => ({
        config: null,
        effectiveMode: 'off',
        source: 'no_row',
      }),
    )
    const res = await runFactoryReelAdDraft(deps, makeEvent())
    expect(res.status).toBe('skipped_off')
    expect(res.intentActionId).toBeNull()
    expect(fake.rows).toHaveLength(0)
    expect(deps.loadWorkOrder).not.toHaveBeenCalled()
    expect(deps.createDraft).not.toHaveBeenCalled()
  })

  it('(3) dry_run happy => dry_run_ok, createDraft NOT called, preview recorded', async () => {
    const { deps, fake, graphGet } = happyDeps({ mode: 'dry_run' })
    const res = await runFactoryReelAdDraft(deps, makeEvent())
    expect(res.status).toBe('dry_run_ok')
    expect(deps.createDraft).not.toHaveBeenCalled()
    expect(fake.rows).toHaveLength(1)
    const p = fake.rows[0].payload
    expect(p.status).toBe('dry_run_ok')
    expect(p.post_id).toBe('111111_999')
    expect(p.ad_account_id).toBe(META.adAccountId)
    const preview = p.draft_preview as Record<string, unknown>
    expect(preview.postId).toBe('111111_999')
    expect(preview.adAccountId).toBe(META.adAccountId)
    expect(String(preview.campaignName)).toContain('[ME-DRAFT] 22222222')
    expect(deps.graphGetWith).toHaveBeenCalledWith('page-tok')
    expect(graphGet).toHaveBeenCalled()
  })

  it('(4) on happy => drafted, createDraft called once with expected draft', async () => {
    const { deps, fake, createDraft, capturedIntentStatus } = happyDeps({ mode: 'on' })
    const res = await runFactoryReelAdDraft(deps, makeEvent())
    expect(res.status).toBe('drafted')
    expect(res.draftActionId).toBe('draft1')
    expect(createDraft).toHaveBeenCalledTimes(1)
    // 意图行必须在任何 Meta 写入之前就已存在（status 'started'）
    expect(capturedIntentStatus.value).toBe('started')
    const [draftArg, depsArg] = createDraft.mock.calls[0] as [AdDraft, Record<string, unknown>]
    expect(draftArg.kind).toBe('video_thruplay')
    expect(draftArg.clientId).toBe(CLIENT_ID)
    expect(draftArg.dailyBudget).toBe(20)
    expect(draftArg.durationDays).toBe(7)
    expect(draftArg.ageMin).toBe(25)
    expect(draftArg.ageMax).toBe(55)
    expect(draftArg.geoCountries).toEqual(['US'])
    expect(draftArg.geoCityKeys).toEqual(['2420605']) // 配置给了城市就必须原样带上（丢掉就变成投整个国家）
    expect(draftArg.pageId).toBe('111111')
    expect(draftArg.creatives).toHaveLength(1)
    expect(draftArg.creatives[0].postId).toBe('111111_999')
    expect(draftArg.campaignName.startsWith('[ME-DRAFT] 22222222')).toBe(true)
    expect(draftArg.adSetName.startsWith('[ME-DRAFT] 22222222')).toBe(true)
    expect(depsArg.adAccountId).toBe(META.adAccountId)
    expect(depsArg.expectedGeo).toBe(META.country)
    expect(depsArg.industry).toBe(META.industry)
    expect(depsArg.accessToken).toBe('tok-abc')
    expect(depsArg.brandRedlines).toEqual([])
    const p = fake.rows[0].payload
    expect(p.status).toBe('drafted')
    expect(p.draft_action_id).toBe('draft1')
    expect(p.provider_impact).toBe('paused_objects_created')
    expect(p.ad_account_id).toBe(META.adAccountId)
  })

  it('(5) second run same event same mode => duplicate, createDraft not called again', async () => {
    const { deps, fake, createDraft } = happyDeps({ mode: 'on' })
    const first = await runFactoryReelAdDraft(deps, makeEvent())
    expect(first.status).toBe('drafted')
    const second = await runFactoryReelAdDraft(deps, makeEvent())
    expect(second.status).toBe('duplicate')
    expect(createDraft).toHaveBeenCalledTimes(1)
    expect(fake.rows).toHaveLength(1)
  })

  it('(6) dry_run then on for same event => both proceed (different rows)', async () => {
    const fake = makeFakeSupabase()
    const dry = happyDeps({ mode: 'dry_run', fake })
    const on = happyDeps({ mode: 'on', fake })
    const r1 = await runFactoryReelAdDraft(dry.deps, makeEvent())
    const r2 = await runFactoryReelAdDraft(on.deps, makeEvent())
    expect(r1.status).toBe('dry_run_ok')
    expect(r2.status).toBe('drafted')
    expect(fake.rows).toHaveLength(2)
  })

  // ── 阻断用例 ──────────────────────────────────────────────────────────────

  async function expectBlock(
    mutate: (deps: RunDeps) => void,
    code: string,
    mode: 'dry_run' | 'on' = 'on',
  ): Promise<void> {
    const { deps, fake } = happyDeps({ mode })
    mutate(deps)
    const res = await runFactoryReelAdDraft(deps, makeEvent())
    expect(res.status).toBe('blocked')
    expect(res.blockCode).toBe(code)
    expect(deps.createDraft).not.toHaveBeenCalled()
    expect(fake.rows).toHaveLength(1)
    expect(fake.rows[0].payload.status).toBe('blocked')
    expect(fake.rows[0].payload.block_code).toBe(code)
  }

  it('(7a) work order missing => work_order_not_found', async () => {
    await expectBlock((d) => {
      d.loadWorkOrder = vi.fn(async () => ({ ok: true as const, row: null }))
    }, 'work_order_not_found')
  })

  it('(7b) loadWorkOrder error => work_order_unreadable', async () => {
    await expectBlock((d) => {
      d.loadWorkOrder = vi.fn(async () => ({ ok: false as const, error: 'boom' }))
    }, 'work_order_unreadable')
  })

  it('(7c) stale => stale', async () => {
    const { deps, fake } = happyDeps({ mode: 'on' })
    deps.nowMs = () => Date.parse('2026-10-09T08:00:00.000Z') // 7h after publish
    const res = await runFactoryReelAdDraft(deps, makeEvent())
    expect(res.status).toBe('blocked')
    expect(res.blockCode).toBe('stale')
    expect(deps.createDraft).not.toHaveBeenCalled()
    expect(fake.rows[0].payload.status).toBe('blocked')
  })

  it('(7d) redlines null => redlines_unreadable', async () => {
    await expectBlock((d) => {
      d.loadRedlines = vi.fn(async () => null)
    }, 'redlines_unreadable')
  })

  it('(7e) caption hits a redline => copy_redline_hit', async () => {
    await expectBlock((d) => {
      d.loadRedlines = vi.fn(async () => ['coast'])
    }, 'copy_redline_hit')
  })

  it('(7f) page differs => page_not_registered', async () => {
    await expectBlock((d) => {
      d.loadClientMeta = vi.fn(async () => ({ ...META, facebookPageId: '999999' }))
    }, 'page_not_registered')
  })

  it('(7g) no ad account => ad_account_missing', async () => {
    await expectBlock((d) => {
      d.loadClientMeta = vi.fn(async () => ({ ...META, adAccountId: null }))
    }, 'ad_account_missing')
  })

  it('(7h) ad account not registered => ad_account_not_registered', async () => {
    await expectBlock((d) => {
      d.isAdAccountRegistered = vi.fn(async () => false)
    }, 'ad_account_not_registered')
  })

  it('(7i) ad account unreadable => ad_account_unreadable', async () => {
    await expectBlock((d) => {
      d.isAdAccountRegistered = vi.fn(async () => null)
    }, 'ad_account_unreadable')
  })

  it('(7j) token null => token_missing', async () => {
    await expectBlock((d) => {
      d.resolveToken = vi.fn(async () => null)
    }, 'token_missing')
  })

  it('(7k) token shared_fallback => token_shared_fallback', async () => {
    await expectBlock((d) => {
      d.resolveToken = vi.fn(async () => ({ token: 'tok', source: 'shared_fallback' }))
    }, 'token_shared_fallback')
  })

  it('(7l) probeToken not ok => token_dead', async () => {
    await expectBlock((d) => {
      d.probeToken = vi.fn(async () => ({ ok: false, detail: 'expired' }))
    }, 'token_dead')
  })

  it('(7m) page token null => page_token_missing', async () => {
    await expectBlock((d) => {
      d.loadPageToken = vi.fn(async () => null)
    }, 'page_token_missing')
  })

  it('(7n) post resolver fails => post_unresolved:*', async () => {
    const { deps, fake } = happyDeps({ mode: 'on' })
    const badGraphGet = vi.fn(
      async (_path: string, _query: Record<string, string>): Promise<GraphGetResult> => ({
        ok: false,
        status: 400,
        body: null,
      }),
    )
    deps.graphGetWith = vi.fn((_pageToken: string) => badGraphGet)
    const res = await runFactoryReelAdDraft(deps, makeEvent())
    expect(res.status).toBe('blocked')
    expect(res.blockCode?.startsWith('post_unresolved')).toBe(true)
    expect(deps.createDraft).not.toHaveBeenCalled()
    expect(fake.rows[0].payload.status).toBe('blocked')
  })

  it('(8) createDraft blocked => draft_blocked', async () => {
    const { deps, fake } = happyDeps({
      mode: 'on',
      createDraft: vi.fn(
        async (): Promise<CreateDraftOutcome> => ({
          actionId: 'draft1',
          status: 'blocked',
          summary: 'blocked',
          findings: [
            { code: 'not_paused', severity: 'blocker', message: 'x', learnedFrom: 'x' },
          ],
          error: 'geo mismatch',
        }),
      ),
    })
    const res = await runFactoryReelAdDraft(deps, makeEvent())
    expect(res.status).toBe('draft_blocked')
    expect(fake.rows[0].payload.status).toBe('draft_blocked')
  })

  it('(9) createDraft actionId null => failed, error mentions name tag', async () => {
    const { deps, fake } = happyDeps({
      mode: 'on',
      createDraft: vi.fn(
        async (): Promise<CreateDraftOutcome> => ({
          actionId: null,
          status: 'failed',
          summary: 'no ledger',
          findings: [],
        }),
      ),
    })
    const res = await runFactoryReelAdDraft(deps, makeEvent())
    expect(res.status).toBe('failed')
    expect(fake.rows[0].payload.status).toBe('failed')
    expect(String(fake.rows[0].payload.error)).toContain('[ME-DRAFT] 22222222')
  })

  it('(10) createDraft throws => failed, provider_impact unknown, no throw', async () => {
    const { deps, fake } = happyDeps({
      mode: 'on',
      createDraft: vi.fn(async () => {
        throw new Error('kaboom')
      }),
    })
    const res = await runFactoryReelAdDraft(deps, makeEvent())
    expect(res.status).toBe('failed')
    expect(fake.rows[0].payload.status).toBe('failed')
    expect(fake.rows[0].payload.provider_impact).toBe('unknown')
  })

  it('(11) finishIntent failure surfaces as recordError', async () => {
    const fake = makeFakeSupabase({ updateMatchesZero: true })
    const { deps } = happyDeps({ mode: 'dry_run', fake })
    const res = await runFactoryReelAdDraft(deps, makeEvent())
    expect(res.status).toBe('dry_run_ok')
    expect(res.recordError).toBeTruthy()
  })

  it('(12) dry_run but a gate fails => still blocked', async () => {
    await expectBlock((d) => {
      d.loadWorkOrder = vi.fn(async () => ({ ok: true as const, row: null }))
    }, 'work_order_not_found', 'dry_run')
  })

  it('(13) blocked with not_paused finding => provider_impact unknown, error warns about spending', async () => {
    const { deps, fake } = happyDeps({
      mode: 'on',
      createDraft: vi.fn(
        async (): Promise<CreateDraftOutcome> => ({
          actionId: 'draft1',
          status: 'blocked',
          summary: 's',
          findings: [
            { code: 'not_paused', severity: 'blocker', message: 'm', learnedFrom: 'l' },
          ],
          error: 'x',
        }),
      ),
    })
    const res = await runFactoryReelAdDraft(deps, makeEvent())
    expect(res.status).toBe('draft_blocked')
    const p = fake.rows[0].payload
    expect(p.status).toBe('draft_blocked')
    expect(p.provider_impact).toBe('unknown')
    expect(String(p.error)).toContain('可能正在花钱')
    // 待办靠这段文字认出「可能在花钱」——两边必须共用同一个常量，改一边另一边会立刻变红
    expect(String(p.error)).toContain(NOT_PAUSED_MARKER)
  })

  it('(14) blocked without not_paused finding => provider_impact stays paused_objects_created', async () => {
    const { deps, fake } = happyDeps({
      mode: 'on',
      createDraft: vi.fn(
        async (): Promise<CreateDraftOutcome> => ({
          actionId: 'draft1',
          status: 'blocked',
          summary: 's',
          findings: [
            { code: 'geo_mismatch', severity: 'blocker', message: 'm', learnedFrom: 'l' },
          ],
          error: 'x',
        }),
      ),
    })
    const res = await runFactoryReelAdDraft(deps, makeEvent())
    expect(res.status).toBe('draft_blocked')
    const p = fake.rows[0].payload
    expect(p.status).toBe('draft_blocked')
    expect(p.provider_impact).toBe('paused_objects_created')
  })

  it('(15) exception before any Meta call => provider_impact none, no name tag in error', async () => {
    const { deps, fake } = happyDeps({ mode: 'on' })
    deps.loadClientMeta = vi.fn(async () => {
      throw new Error('meta read boom')
    })
    const res = await runFactoryReelAdDraft(deps, makeEvent())
    expect(res.status).toBe('failed')
    const p = fake.rows[0].payload
    expect(p.status).toBe('failed')
    expect(p.provider_impact).toBe('none')
    expect(String(p.error)).not.toContain('[ME-DRAFT]')
  })

  it('(16) exception thrown by createDraft => provider_impact unknown, error has name tag', async () => {
    const { deps, fake } = happyDeps({
      mode: 'on',
      createDraft: vi.fn(async () => {
        throw new Error('kaboom')
      }),
    })
    const res = await runFactoryReelAdDraft(deps, makeEvent())
    expect(res.status).toBe('failed')
    const p = fake.rows[0].payload
    expect(p.status).toBe('failed')
    expect(p.provider_impact).toBe('unknown')
    expect(String(p.error)).toContain('[ME-DRAFT] 22222222')
  })
})
