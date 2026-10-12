// Tests for the "PM accepted this quality flag" server feature.
// mockSupabase is a thenable builder: each awaited query chain consumes the next queued
// response, and we additionally track call counts and insert payloads.

import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  applyAcceptFlag,
  matchAcceptedFlags,
  narratorBriefFingerprint,
  type AcceptanceRow,
} from './review-accept-flag'

type Resp = { data: unknown; error: unknown }

interface MockDb {
  db: SupabaseClient
  inserts: unknown[]
  callCount: () => number
}

/** Each awaited query chain consumes the next queued response (in call order). */
function mockSupabase(queue: Resp[]): MockDb {
  let i = 0
  let calls = 0
  const inserts: unknown[] = []
  const builder: Record<string, unknown> = {}
  const passthrough = ['select', 'eq', 'in', 'order', 'limit', 'update', 'maybeSingle', 'single']
  for (const m of passthrough) builder[m] = () => builder
  builder.insert = (rows: unknown) => {
    inserts.push(rows)
    return builder
  }
  ;(builder as { then: unknown }).then = (resolve: (r: Resp) => unknown) => {
    calls += 1
    return resolve(queue[i++] ?? { data: null, error: null })
  }
  const db = { from: () => builder } as unknown as SupabaseClient
  return { db, inserts, callCount: () => calls }
}

const NARRATOR_BRIEF = {
  brand_name: 'Acme',
  brand_voice: { persona: { name: 'Nova', role: 'host' } },
}

const IN_REVIEW_WO = {
  id: 'wo-1',
  client_id: 'c-1',
  status: 'in_review',
  output: { quality_flags: [{ category: 'narrator_voice_mismatch' }] },
  brief: NARRATOR_BRIEF,
}

const accept = (db: SupabaseClient, category: unknown, reviewer = 'pm@x.com', note?: string) =>
  applyAcceptFlag(db, 'wo-1', category, reviewer, note)

describe('applyAcceptFlag — category gate (before any DB call)', () => {
  const rejected = ['competitor_brand', 'placeholder_caption', 'quality_check_unavailable', 'redline', '', undefined]

  for (const category of rejected) {
    it(`rejects ${JSON.stringify(category)} with 400 and zero supabase calls`, async () => {
      const mock = mockSupabase([])
      const r = await accept(mock.db, category)
      expect(r.ok).toBe(false)
      expect(r.status).toBe(400)
      expect(mock.callCount()).toBe(0)
      expect(mock.inserts).toHaveLength(0)
    })
  }
})

describe('applyAcceptFlag — happy path', () => {
  it('inserts exactly one row with the brief fingerprint and reviewer', async () => {
    const mock = mockSupabase([
      { data: IN_REVIEW_WO, error: null },
      { data: { accepted_at: '2026-01-01T00:00:00.000Z' }, error: null },
    ])
    const r = await accept(mock.db, 'narrator_voice_mismatch', 'pm@x.com', 'ok by me')
    expect(r.ok).toBe(true)
    expect(r.status).toBe(200)
    expect(mock.inserts).toHaveLength(1)
    const row = mock.inserts[0] as Record<string, unknown>
    expect(row.brief_fingerprint).toBe(narratorBriefFingerprint(NARRATOR_BRIEF))
    expect(row.accepted_by).toBe('pm@x.com')
    expect(row.category).toBe('narrator_voice_mismatch')
    expect(row.client_id).toBe('c-1')
    expect(row.work_order_id).toBe('wo-1')
    expect(row.note).toBe('ok by me')
  })
})

describe('applyAcceptFlag — guard rails', () => {
  it('409 and no insert when the flag is not present', async () => {
    const wo = { ...IN_REVIEW_WO, output: { quality_flags: [{ category: 'redline' }] } }
    const mock = mockSupabase([{ data: wo, error: null }])
    const r = await accept(mock.db, 'narrator_voice_mismatch')
    expect(r.status).toBe(409)
    expect(mock.inserts).toHaveLength(0)
  })

  it('409 and no insert when the order is not in_review', async () => {
    const wo = { ...IN_REVIEW_WO, status: 'approved' }
    const mock = mockSupabase([{ data: wo, error: null }])
    const r = await accept(mock.db, 'narrator_voice_mismatch')
    expect(r.status).toBe(409)
    expect(mock.inserts).toHaveLength(0)
  })

  it('422 and no insert when the brief has no persona name', async () => {
    const wo = { ...IN_REVIEW_WO, brief: { brand_name: 'Acme', brand_voice: { persona: {} } } }
    const mock = mockSupabase([{ data: wo, error: null }])
    const r = await accept(mock.db, 'narrator_voice_mismatch')
    expect(r.status).toBe(422)
    expect(mock.inserts).toHaveLength(0)
  })

  it('404 when the work order does not exist', async () => {
    const mock = mockSupabase([{ data: null, error: null }])
    const r = await accept(mock.db, 'narrator_voice_mismatch')
    expect(r.status).toBe(404)
    expect(mock.inserts).toHaveLength(0)
  })
})

describe('matchAcceptedFlags', () => {
  const fingerprint = narratorBriefFingerprint(NARRATOR_BRIEF) as string
  const baseRow: AcceptanceRow = {
    client_id: 'c-1',
    category: 'narrator_voice_mismatch',
    brief_fingerprint: fingerprint,
    accepted_by: 'pm@x.com',
    accepted_at: '2026-01-01T00:00:00.000Z',
  }

  it('returns one view for same client + same fingerprint', () => {
    const views = matchAcceptedFlags([baseRow], { client_id: 'c-1', brief: NARRATOR_BRIEF })
    expect(views).toHaveLength(1)
    expect(views[0].category).toBe('narrator_voice_mismatch')
  })

  it('returns [] when the persona name changed', () => {
    const changed = { brand_name: 'Acme', brand_voice: { persona: { name: 'Other', role: 'host' } } }
    expect(matchAcceptedFlags([baseRow], { client_id: 'c-1', brief: changed })).toEqual([])
  })

  it('returns [] for a different client_id', () => {
    expect(matchAcceptedFlags([baseRow], { client_id: 'c-2', brief: NARRATOR_BRIEF })).toEqual([])
  })

  it('returns [] for a non-acceptable category row', () => {
    const bad = { ...baseRow, category: 'competitor_brand' }
    expect(matchAcceptedFlags([bad], { client_id: 'c-1', brief: NARRATOR_BRIEF })).toEqual([])
  })

  it('keeps only the newest row per category', () => {
    const older = { ...baseRow, accepted_at: '2025-01-01T00:00:00.000Z', accepted_by: 'old@x.com' }
    const newer = { ...baseRow, accepted_at: '2026-06-01T00:00:00.000Z', accepted_by: 'new@x.com' }
    const views = matchAcceptedFlags([older, newer], { client_id: 'c-1', brief: NARRATOR_BRIEF })
    expect(views).toHaveLength(1)
    expect(views[0].accepted_by).toBe('new@x.com')
  })
})

describe('narratorBriefFingerprint', () => {
  it('changes when brand_name changes', () => {
    const a = narratorBriefFingerprint(NARRATOR_BRIEF)
    const b = narratorBriefFingerprint({ ...NARRATOR_BRIEF, brand_name: 'Other' })
    expect(a).not.toBe(b)
  })

  it('changes when persona name changes', () => {
    const a = narratorBriefFingerprint(NARRATOR_BRIEF)
    const b = narratorBriefFingerprint({ brand_name: 'Acme', brand_voice: { persona: { name: 'Zed', role: 'host' } } })
    expect(a).not.toBe(b)
  })

  it('changes when persona role changes', () => {
    const a = narratorBriefFingerprint(NARRATOR_BRIEF)
    const b = narratorBriefFingerprint({ brand_name: 'Acme', brand_voice: { persona: { name: 'Nova', role: 'narrator' } } })
    expect(a).not.toBe(b)
  })

  it('is identical for whitespace-only differences', () => {
    const a = narratorBriefFingerprint(NARRATOR_BRIEF)
    const b = narratorBriefFingerprint({ brand_name: '  Acme ', brand_voice: { persona: { name: ' Nova ', role: ' host ' } } })
    expect(a).toBe(b)
  })

  it('is null when the persona is missing', () => {
    expect(narratorBriefFingerprint({ brand_name: 'Acme' })).toBeNull()
    expect(narratorBriefFingerprint({ brand_name: 'Acme', brand_voice: { persona: { role: 'host' } } })).toBeNull()
  })
})
