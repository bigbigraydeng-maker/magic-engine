import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  FACTORY_REEL_DRAFT_ACTION,
  buildIntentKey,
  claimIntent,
  type IntentPayload,
  type ClaimInput,
} from '../intent-ledger'
import { recordUnhandledFailure } from '../on-failure'

// ── 内存版 flywheel_actions 假表 ─────────────────────────────────────────────
//
// 只实现被测代码用到的调用形状：
//   insert(row).select('id').single()
//   select(cols).eq(...).eq(...).eq(...).maybeSingle()
//   update({...}).eq(...).eq(...).select('id')
// 并模拟部分唯一索引 (client_id, action_type, payload.idempotency_key)：
// 重复时返回 { code: '23505' }。

interface FakeRow {
  id: string
  client_id: string
  action_type: string
  payload: IntentPayload
}

interface FakeConfig {
  /** 让下一次 insert 直接返回这个错误（绕过唯一索引）。 */
  insertError?: { code?: string; message: string }
  /** 让 insert 无条件返回 23505（即使表里没有匹配行），用于测试回读找不到行。 */
  forceUniqueViolationOnInsert?: boolean
  /** 让 23505 之后的回读返回错误。 */
  readBackError?: { message: string }
  /** 让 23505 之后的回读返回空（模拟行不可见）。 */
  readBackEmpty?: boolean
  /** 让 update 返回错误。 */
  updateError?: { message: string }
  /** 让 update 匹配 0 行（模拟乐观锁失败）。 */
  updateMatchesZero?: boolean
  /** 让 select(...).maybeSingle() 返回错误（用于 on-failure 的 read_error）。 */
  selectError?: { message: string }
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
        insert(row: {
          client_id: string
          action_type: string
          payload: IntentPayload
        }) {
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
                single: async () => ({ data: null, error: { code: '23505', message: 'duplicate key' } }),
              }),
            }
          }
          const dup = findUnique(row.client_id, row.action_type, row.payload.idempotency_key)
          if (dup) {
            return {
              select: () => ({
                single: async () => ({ data: null, error: { code: '23505', message: 'duplicate key' } }),
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
              if (config.selectError) return { data: null, error: config.selectError }
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

const CLIENT_ID = '11111111-1111-4111-8111-111111111111'
const WORK_ORDER_ID = '22222222-2222-4222-8222-222222222222'
const REQUEST_ID = '33333333-3333-4333-8333-333333333333'
const PAGE_ID = '111111'
const VIDEO_ID = '222222'
const PUBLISHED_AT = '2026-10-09T01:00:00.000Z'

const baseInput = (over: Partial<ClaimInput> = {}): ClaimInput => ({
  requestId: REQUEST_ID,
  clientId: CLIENT_ID,
  workOrderId: WORK_ORDER_ID,
  videoId: VIDEO_ID,
  pageId: PAGE_ID,
  mode: 'on',
  nowIso: '2025-01-01T00:00:00.000Z',
  ...over,
})

/** 与 FactoryReelPublishedEventSchema 期望形状一致的事件数据。 */
const baseEvent = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  schema_version: 1,
  request_id: REQUEST_ID,
  work_order_id: WORK_ORDER_ID,
  client_id: CLIENT_ID,
  platform: 'facebook',
  page_id: PAGE_ID,
  video_id: VIDEO_ID,
  post_id: VIDEO_ID,
  media_type: 'reel',
  published_at: PUBLISHED_AT,
  status: 'PUBLISHED',
  no_publish: false,
  authorization: 'AUTHORIZED',
  cost_usd: 0,
  created_at: PUBLISHED_AT,
  ...over,
})

const NOW = '2025-01-01T03:00:00.000Z'

// ── recordUnhandledFailure ──────────────────────────────────────────────────

describe('recordUnhandledFailure', () => {
  it("finishes a started 'on' intent as failed with the error text and provider_impact 'unknown'", async () => {
    const fake = makeFakeSupabase()
    const claim = await claimIntent(fake.client, baseInput({ mode: 'on' }))
    expect(claim.ok).toBe(true)

    const res = await recordUnhandledFailure(
      fake.client,
      baseEvent(),
      new Error('boom'),
      NOW,
    )
    expect(res).toEqual({ ok: true, finished: 1, inserted: 0 })

    const p = fake.rows[0].payload
    expect(p.status).toBe('failed')
    expect(p.error).toContain('boom')
    expect(p.error).toContain('函数异常')
    expect(p.provider_impact).toBe('unknown')
    expect(p.updated_at).toBe(NOW)
  })

  it("finishes a started 'dry_run' intent as failed", async () => {
    const fake = makeFakeSupabase()
    const claim = await claimIntent(fake.client, baseInput({ mode: 'dry_run' }))
    expect(claim.ok).toBe(true)

    const res = await recordUnhandledFailure(
      fake.client,
      baseEvent(),
      new Error('dry boom'),
      NOW,
    )
    expect(res).toEqual({ ok: true, finished: 1, inserted: 0 })

    const p = fake.rows[0].payload
    expect(p.status).toBe('failed')
    expect(p.error).toContain('dry boom')
    expect(p.provider_impact).toBe('unknown')
  })

  it('finishes both started intents (dry_run and on) and reports finished: 2', async () => {
    const fake = makeFakeSupabase()
    await claimIntent(fake.client, baseInput({ mode: 'dry_run' }))
    await claimIntent(fake.client, baseInput({ mode: 'on' }))
    expect(fake.rows).toHaveLength(2)

    const res = await recordUnhandledFailure(fake.client, baseEvent(), new Error('both'), NOW)
    expect(res).toEqual({ ok: true, finished: 2, inserted: 0 })
    expect(fake.rows.every((r) => r.payload.status === 'failed')).toBe(true)
  })

  it("does not overwrite an already 'drafted' intent and writes an unhandled_failure receipt", async () => {
    const fake = makeFakeSupabase()
    const claim = await claimIntent(fake.client, baseInput({ mode: 'on' }))
    if (!claim.ok) throw new Error('claim failed')
    fake.rows[0].payload.status = 'drafted'

    const res = await recordUnhandledFailure(fake.client, baseEvent(), new Error('late'), NOW)
    expect(res).toEqual({ ok: true, finished: 0, inserted: 1 })

    // 原来的 drafted 行保持不动
    expect(fake.rows[0].payload.status).toBe('drafted')

    // 新增一行收据
    expect(fake.rows).toHaveLength(2)
    const receipt = fake.rows[1].payload
    expect(receipt.status).toBe('failed')
    expect(receipt.block_code).toBe('unhandled_failure')
    expect(receipt.idempotency_key).toBe(`factory-reel-ad:unhandled:${REQUEST_ID}`)
    expect(receipt.error).toContain('late')
  })

  it('no rows => writes an unhandled_failure receipt', async () => {
    const fake = makeFakeSupabase()
    const res = await recordUnhandledFailure(fake.client, baseEvent(), new Error('none'), NOW)
    expect(res).toEqual({ ok: true, finished: 0, inserted: 1 })

    expect(fake.rows).toHaveLength(1)
    const receipt = fake.rows[0].payload
    expect(receipt.status).toBe('failed')
    expect(receipt.block_code).toBe('unhandled_failure')
    expect(receipt.idempotency_key).toBe(`factory-reel-ad:unhandled:${REQUEST_ID}`)
    expect(receipt.error).toContain('none')
  })

  it('a second call for the same event inserts nothing (23505) and keeps one row', async () => {
    const fake = makeFakeSupabase()
    const first = await recordUnhandledFailure(fake.client, baseEvent(), new Error('once'), NOW)
    expect(first).toEqual({ ok: true, finished: 0, inserted: 1 })

    const second = await recordUnhandledFailure(fake.client, baseEvent(), new Error('twice'), NOW)
    expect(second).toEqual({ ok: true, finished: 0, inserted: 0 })
    expect(fake.rows).toHaveLength(1)
  })

  it('insert error with a non-23505 code => write_error', async () => {
    const fake = makeFakeSupabase({ insertError: { code: 'XX000', message: 'insert exploded' } })
    const res = await recordUnhandledFailure(fake.client, baseEvent(), new Error('x'), NOW)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toBe('write_error')
    expect(res.message).toBe('insert exploded')
  })

  it('invalid event => invalid_event with no db calls', async () => {
    const fake = makeFakeSupabase()
    const res = await recordUnhandledFailure(fake.client, { nope: true }, new Error('x'), NOW)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toBe('invalid_event')
    expect(fake.calls.select).toBe(0)
    expect(fake.calls.insert).toBe(0)
    expect(fake.calls.update).toBe(0)
  })

  it('read error => read_error', async () => {
    const fake = makeFakeSupabase({ selectError: { message: 'db down' } })
    const res = await recordUnhandledFailure(fake.client, baseEvent(), new Error('x'), NOW)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toBe('read_error')
    expect(res.message).toBe('db down')
  })

  it('accepts a string error', async () => {
    const fake = makeFakeSupabase()
    await claimIntent(fake.client, baseInput({ mode: 'on' }))
    const res = await recordUnhandledFailure(fake.client, baseEvent(), 'string failure', NOW)
    expect(res).toEqual({ ok: true, finished: 1, inserted: 0 })
    expect(fake.rows[0].payload.error).toContain('string failure')
  })

  it('accepts a non-Error object', async () => {
    const fake = makeFakeSupabase()
    await claimIntent(fake.client, baseInput({ mode: 'on' }))
    const res = await recordUnhandledFailure(fake.client, baseEvent(), { code: 'E_BOOM' }, NOW)
    expect(res).toEqual({ ok: true, finished: 1, inserted: 0 })
    expect(fake.rows[0].payload.error).toContain('E_BOOM')
  })

  it('truncates the error message to 300 chars', async () => {
    const fake = makeFakeSupabase()
    await claimIntent(fake.client, baseInput({ mode: 'on' }))
    const long = 'x'.repeat(1000)
    const res = await recordUnhandledFailure(fake.client, baseEvent(), new Error(long), NOW)
    expect(res).toEqual({ ok: true, finished: 1, inserted: 0 })
    const stored = fake.rows[0].payload.error ?? ''
    // `函数异常：` 前缀 + 最多 300 字符的 message
    expect(stored.length).toBe('函数异常：'.length + 300)
    expect(stored.endsWith('x'.repeat(300))).toBe(true)
  })
})
