import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  FACTORY_REEL_DRAFT_ACTION,
  buildIntentKey,
  claimIntent,
  finishIntent,
  type IntentPayload,
  type ClaimInput,
} from '../intent-ledger'

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

const baseInput = (over: Partial<ClaimInput> = {}): ClaimInput => ({
  requestId: 'req-1',
  clientId: 'client-1',
  workOrderId: 'w1',
  videoId: '222222',
  pageId: 'page-1',
  mode: 'on',
  nowIso: '2025-01-01T00:00:00.000Z',
  ...over,
})

// ── buildIntentKey ──────────────────────────────────────────────────────────

describe('buildIntentKey', () => {
  it('includes the mode so dry_run and on are distinct keys', () => {
    expect(buildIntentKey('w1', '222222', 'on')).toBe('factory-reel-ad:on:w1:222222')
    expect(buildIntentKey('w1', '222222', 'dry_run')).toBe('factory-reel-ad:dry_run:w1:222222')
  })
})

// ── claimIntent ─────────────────────────────────────────────────────────────

describe('claimIntent', () => {
  it('creates a started intent row with the expected payload', async () => {
    const fake = makeFakeSupabase()
    const res = await claimIntent(fake.client, baseInput())
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.created).toBe(true)
    expect(fake.rows).toHaveLength(1)
    const p = fake.rows[0].payload
    expect(p.status).toBe('started')
    expect(p.no_publish).toBe(true)
    expect(p.authorization).toBe('pm_approval_required')
    expect(p.provider_impact).toBe('none')
    expect(p.idempotency_key).toBe('factory-reel-ad:on:w1:222222')
    expect(fake.rows[0].action_type).toBe(FACTORY_REEL_DRAFT_ACTION)
  })

  it('second claim for the same (work order, video, mode) returns the same row', async () => {
    const fake = makeFakeSupabase()
    const first = await claimIntent(fake.client, baseInput())
    const second = await claimIntent(fake.client, baseInput({ requestId: 'req-2' }))
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(second.created).toBe(false)
    expect(second.actionId).toBe(first.actionId)
    if (second.created === false) {
      expect(second.existing.idempotency_key).toBe('factory-reel-ad:on:w1:222222')
      expect(second.existing.status).toBe('started')
    }
    expect(fake.rows).toHaveLength(1)
  })

  it('a different video creates a second row', async () => {
    const fake = makeFakeSupabase()
    await claimIntent(fake.client, baseInput())
    await claimIntent(fake.client, baseInput({ videoId: '333333' }))
    expect(fake.rows).toHaveLength(2)
  })

  it('dry_run then on for the same (work order, video) creates two distinct rows', async () => {
    const fake = makeFakeSupabase()
    const dry = await claimIntent(fake.client, baseInput({ mode: 'dry_run' }))
    const on = await claimIntent(fake.client, baseInput({ mode: 'on' }))
    expect(dry.ok).toBe(true)
    expect(on.ok).toBe(true)
    if (!dry.ok || !on.ok) return
    expect(dry.created).toBe(true)
    expect(on.created).toBe(true)
    expect(dry.actionId).not.toBe(on.actionId)
    expect(fake.rows).toHaveLength(2)
    const keys = fake.rows.map((r) => r.payload.idempotency_key).sort()
    expect(keys).toEqual(['factory-reel-ad:dry_run:w1:222222', 'factory-reel-ad:on:w1:222222'])
  })

  it('non-23505 db error => db_error', async () => {
    const fake = makeFakeSupabase({ insertError: { code: 'XX000', message: 'boom' } })
    const res = await claimIntent(fake.client, baseInput())
    expect(res).toEqual({ ok: false, reason: 'db_error' })
  })

  it('23505 but read-back returns no row => unique_conflict_unreadable', async () => {
    const fake = makeFakeSupabase({ forceUniqueViolationOnInsert: true })
    const res = await claimIntent(fake.client, baseInput())
    expect(res).toEqual({ ok: false, reason: 'unique_conflict_unreadable' })
  })

  it('23505 with a mismatched page_id => identity_mismatch', async () => {
    const fake = makeFakeSupabase()
    await claimIntent(fake.client, baseInput())
    fake.rows[0].payload.page_id = 'other-page'
    const res = await claimIntent(fake.client, baseInput())
    expect(res).toEqual({ ok: false, reason: 'identity_mismatch', field: 'page_id_mismatch' })
  })

  it('23505 with a mismatched mode => identity_mismatch', async () => {
    const fake = makeFakeSupabase()
    await claimIntent(fake.client, baseInput())
    fake.rows[0].payload.mode = 'dry_run'
    const res = await claimIntent(fake.client, baseInput())
    expect(res).toEqual({ ok: false, reason: 'identity_mismatch', field: 'mode_mismatch' })
  })
})

// ── finishIntent ────────────────────────────────────────────────────────────

describe('finishIntent', () => {
  it('moves started => drafted and keeps other fields', async () => {
    const fake = makeFakeSupabase()
    const claim = await claimIntent(fake.client, baseInput())
    if (!claim.ok) throw new Error('claim failed')
    const res = await finishIntent(
      fake.client,
      claim.actionId,
      'drafted',
      { draft_action_id: 'draft-1' },
      '2025-01-01T01:00:00.000Z',
    )
    expect(res).toEqual({ ok: true })
    const p = fake.rows[0].payload
    expect(p.status).toBe('drafted')
    expect(p.draft_action_id).toBe('draft-1')
    expect(p.idempotency_key).toBe('factory-reel-ad:on:w1:222222')
    expect(p.no_publish).toBe(true)
    expect(p.updated_at).toBe('2025-01-01T01:00:00.000Z')
    expect(p.created_at).toBe('2025-01-01T00:00:00.000Z')
  })

  it('finishing twice does not overwrite the stored status', async () => {
    const fake = makeFakeSupabase()
    const claim = await claimIntent(fake.client, baseInput())
    if (!claim.ok) throw new Error('claim failed')
    await finishIntent(fake.client, claim.actionId, 'drafted', {}, '2025-01-01T01:00:00.000Z')
    const second = await finishIntent(
      fake.client,
      claim.actionId,
      'failed',
      { error: 'nope' },
      '2025-01-01T02:00:00.000Z',
    )
    expect(second.ok).toBe(false)
    expect(fake.rows[0].payload.status).toBe('drafted')
  })

  it('empty actionId => ok:false and no db calls', async () => {
    const fake = makeFakeSupabase()
    const res = await finishIntent(fake.client, '', 'drafted', {}, '2025-01-01T01:00:00.000Z')
    expect(res.ok).toBe(false)
    expect(fake.calls.select).toBe(0)
    expect(fake.calls.update).toBe(0)
  })

  it('missing row => ok:false', async () => {
    const fake = makeFakeSupabase()
    const res = await finishIntent(fake.client, 'row-999', 'drafted', {}, '2025-01-01T01:00:00.000Z')
    expect(res.ok).toBe(false)
  })

  it('update matching 0 rows => ok:false', async () => {
    const fake = makeFakeSupabase()
    const claim = await claimIntent(fake.client, baseInput())
    if (!claim.ok) throw new Error('claim failed')
    fake.rows[0].payload.status = 'drafted' // 让乐观锁条件 payload->>status='started' 不匹配
    const res = await finishIntent(
      fake.client,
      claim.actionId,
      'failed',
      {},
      '2025-01-01T02:00:00.000Z',
    )
    expect(res.ok).toBe(false)
  })
})
