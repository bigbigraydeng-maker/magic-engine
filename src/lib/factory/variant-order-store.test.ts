import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createVariantOrder } from './variant-order-store'

const BASE_ID = '11111111-2222-4333-8444-555555555555'
const CLIENT = 'cccccccc-0000-4000-8000-000000000001'

function listBrief() {
  return {
    engine: 'remotion',
    reopened_from: 'old',
    remotion: {
      template: 'list',
      props: {
        hook: { clip: 'clips/hook_tower.mp4', lines: [{ text: 'FROM', badge: null }, { text: 'NZ$1,999', badge: null }, { text: 'DAYS', badge: '10' }] },
        beats: [0.046, 0.955, 1.864, 2.773, 3.682, 4.591, 5.5, 6.409, 7.318, 8.227, 9.136, 10.045, 10.954, 11.863, 12.772, 13.681, 14.59, 15.499, 16.408],
        items: [
          { clip: 'clips/item_a.mp4', text: 'CITY SKYLINE', blurBackdrop: false },
          { clip: 'clips/item_b.mp4', text: 'LAKE BOATS', blurBackdrop: false },
          { clip: 'clips/item_c.mp4', text: 'RIVER SUNSET', blurBackdrop: false },
        ],
        price: { amount: 1999, layout: 'center', dateLine: 'DEPARTS 1 MAY 2027', footnote: 'FLIGHTS INCLUDED', fromLabel: 'FROM', qualifier: 'PER PERSON · TWIN SHARE', backdropClip: 'clips/end.mp4', footnoteSize: 50, qualifierSize: 50, currencyPrefix: 'NZ$', footnoteBackdrop: true },
        cutFlash: false, logoFile: 'logo.png', logoMode: 'always', itemLabel: 'YOUR 10 DAYS',
        musicFile: 'music/jade_river_journey.mp3', brandColor: '#B61E2E', revealTitle: 'LAKE TOWN & COAST.',
        footageScrim: 0.35, itemLabelSize: 52, musicStartSec: 0.118, revealTitleSize: 48, itemOverlayOpacity: 0.08,
      },
    },
  }
}

const okChange = { kind: 'hook' as const, lines: [{ text: 'FROM', badge: null }, { text: 'NZ$1,999', badge: null }, { text: '+ FLIGHTS', badge: null }] }

interface FakeBuilder {
  select: (cols?: string, opts?: Record<string, unknown>) => FakeBuilder
  eq: (col: string, val: unknown) => FakeBuilder
  gte: (col: string, val: unknown) => FakeBuilder
  in: (col: string, vals: unknown) => FakeBuilder
  not: (col: string, op: string, val: unknown) => FakeBuilder
  order: (col: string, opts?: Record<string, unknown>) => FakeBuilder
  limit: (n: number) => FakeBuilder
  maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: null }>
  insert: (payload: Record<string, unknown>) => FakeBuilder
  single: () => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>
  then: (resolve: (v: { count: number; error: null }) => void) => void
}

function fakeSupabase(opts: {
  base: Record<string, unknown> | null
  recentCount?: number
  insertError?: string
}): { client: { from: (table: string) => FakeBuilder }; inserts: Record<string, unknown>[]; filters: string[] } {
  const inserts: Record<string, unknown>[] = []
  const filters: string[] = []

  const makeBuilder = (): FakeBuilder => {
    let isHeadCount = false
    const builder: FakeBuilder = {
      select: (_cols?: string, selOpts?: Record<string, unknown>) => {
        if (selOpts && selOpts.head === true) isHeadCount = true
        return builder
      },
      eq: (col: string, val: unknown) => {
        filters.push(`${col}=${String(val)}`)
        return builder
      },
      gte: () => builder,
      in: () => builder,
      not: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: () => Promise.resolve({ data: opts.base, error: null }),
      insert: (payload: Record<string, unknown>) => {
        inserts.push(payload)
        return builder
      },
      single: () =>
        Promise.resolve(
          opts.insertError
            ? { data: null, error: { message: opts.insertError } }
            : { data: { id: 'new-order-id', status: 'queued' }, error: null },
        ),
      then: (resolve: (v: { count: number; error: null }) => void) => {
        if (isHeadCount) {
          resolve({ count: opts.recentCount ?? 0, error: null })
        } else {
          resolve({ count: 0, error: null })
        }
      },
    }
    return builder
  }

  const client = {
    from: (_table: string) => makeBuilder(),
  }
  return { client, inserts, filters }
}

const baseRow = (over: Record<string, unknown> = {}) => ({
  id: BASE_ID,
  client_id: CLIENT,
  goal_id: 'g1',
  master_brief_id: 'm1',
  order_type: 'fresh_angle',
  budget_cap_usd: 0.5,
  status: 'published',
  brief: listBrief(),
  video_path: 'renders/x/final.mp4',
  ...over,
})

const req = (change = okChange) => ({ baseId: BASE_ID, change, note: 'try flights', actor: 'pm@test' })

function at(obj: unknown, ...keys: (string | number)[]): unknown {
  let cur: unknown = obj
  for (const key of keys) {
    if (typeof key === 'number') {
      if (!Array.isArray(cur)) return undefined
      cur = cur[key]
    } else {
      if (typeof cur !== 'object' || cur === null || Array.isArray(cur)) return undefined
      cur = (cur as Record<string, unknown>)[key]
    }
  }
  return cur
}

describe('createVariantOrder', () => {
  it('happy path: inserts a queued variant order with the new hook', async () => {
    const fake = fakeSupabase({ base: baseRow() })
    const result = await createVariantOrder(fake.client as never, req())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.id).toBe('new-order-id')
    expect(result.data.status).toBe('queued')
    expect(result.data.summary).toContain('+ FLIGHTS')

    expect(fake.inserts).toHaveLength(1)
    const insert = fake.inserts[0]
    expect(insert.status).toBe('queued')
    expect(insert.client_id).toBe(CLIENT)
    expect(insert.goal_id).toBe('g1')
    expect(insert.master_brief_id).toBe('m1')
    expect(insert.order_type).toBe('fresh_angle')
    expect(insert.budget_cap_usd).toBe(0.5)

    const angle = insert.angle
    expect(typeof angle).toBe('string')
    expect(String(angle).startsWith('变体（底稿 11111111）')).toBe(true)

    expect(at(insert, 'angle_source', 'source')).toBe('me_variant_order')
    expect(at(insert, 'angle_source', 'base_work_order_id')).toBe(BASE_ID)
    expect(at(insert, 'angle_source', 'ordered_by')).toBe('pm@test')
    expect(at(insert, 'angle_source', 'stops_at')).toBe('in_review')

    for (const forbidden of ['signal_id', 'source_ad_id', 'winner_structure_id', 'review_ref', 'published_ref']) {
      expect(Object.prototype.hasOwnProperty.call(insert, forbidden)).toBe(false)
    }

    expect(at(insert, 'brief', 'variant_of', 'base_work_order_id')).toBe(BASE_ID)
    expect(at(insert, 'brief', 'reopened_from')).toBeUndefined()
    expect(at(insert, 'brief', 'remotion', 'props', 'hook', 'lines', 2, 'text')).toBe('+ FLIGHTS')
  })

  it('daily-cap query filters by client and source', async () => {
    const fake = fakeSupabase({ base: baseRow() })
    await createVariantOrder(fake.client as never, req())

    expect(fake.filters).toContain(`client_id=${CLIENT}`)
    expect(fake.filters).toContain('angle_source->>source=me_variant_order')
  })

  it('missing base -> 404, no insert', async () => {
    const fake = fakeSupabase({ base: null })
    const result = await createVariantOrder(fake.client as never, req())

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(404)
    expect(fake.inserts).toHaveLength(0)
  })

  it('base still rendering -> 409, no insert', async () => {
    const fake = fakeSupabase({ base: baseRow({ status: 'producing' }) })
    const result = await createVariantOrder(fake.client as never, req())

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(409)
    expect(fake.inserts).toHaveLength(0)
  })

  it('base without video -> 409, no insert', async () => {
    const fake = fakeSupabase({ base: baseRow({ video_path: null }) })
    const result = await createVariantOrder(fake.client as never, req())

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(409)
    expect(fake.inserts).toHaveLength(0)
  })

  it('daily cap reached -> 429, no insert', async () => {
    const fake = fakeSupabase({ base: baseRow(), recentCount: 10 })
    const result = await createVariantOrder(fake.client as never, req())

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(429)
    expect(fake.inserts).toHaveLength(0)
  })

  it('hook line too long -> 422, no insert', async () => {
    const fake = fakeSupabase({ base: baseRow() })
    const change = {
      kind: 'hook' as const,
      lines: [
        { text: 'FROM', badge: null },
        { text: 'NZ$1,999', badge: null },
        { text: 'FLIGHTS INCLUDED', badge: null },
      ],
    }
    const result = await createVariantOrder(fake.client as never, req(change))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(422)
    expect(result.error).toContain('第 3 行太长')
    expect(fake.inserts).toHaveLength(0)
  })

  it('base budget missing -> insert budget_cap_usd 0.5', async () => {
    const fake = fakeSupabase({ base: baseRow({ budget_cap_usd: null }) })
    const result = await createVariantOrder(fake.client as never, req())

    expect(result.ok).toBe(true)
    expect(fake.inserts).toHaveLength(1)
    expect(fake.inserts[0].budget_cap_usd).toBe(0.5)
  })

  it('insert error -> 500 with message', async () => {
    const fake = fakeSupabase({ base: baseRow(), insertError: 'boom' })
    const result = await createVariantOrder(fake.client as never, req())

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(500)
    expect(result.error).toContain('boom')
  })
})
