/**
 * 打通电话后把「新线索」推进到「已联系」。
 *
 * 钉死的几件事：只动 AI 放进新线索的人（人手标的不碰）· 必须是「接通」的外呼 ·
 * 写库时再判一次阶段没被改 · 留痕写不上就退回。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const mocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))

import { advanceNewLeadsAfterFollowUp } from '../advance-after-call'
import { CALL_REACHED_ACTOR, ENQUIRY_REVIVE_ACTOR, STAGE_INFER_ACTOR } from '../actors'

const NOW = new Date('2026-10-28T00:00:00Z')
const CLIENT = 'client-1'
const STAGE_AT = '2026-10-26T13:11:56.048+00'

interface Fake {
  stages: string[]
  contacts: { id: string; client_id: string; stage_updated_at: string | null }[]
  events: { contact_id: string; changed_by: string | null; to_stage: string | null; created_at: string }[]
  touches: { contact_id: string; channel: string; source?: string | null; metadata: Record<string, unknown> | null }[]
  updated: number
  auditErr?: string
}

let updates: Record<string, unknown>[]
let audits: Record<string, unknown>[]
let filters: [string, unknown][]
let gtValue: string | null
let limitValue: number | null

function chain(result: () => unknown) {
  const b: Record<string, unknown> = {}
  const self = () => b
  for (const m of ['select', 'in', 'is', 'order']) b[m] = self
  b.limit = (n: number) => {
    limitValue = n
    return b
  }
  b.gt = (_c: string, v: string) => {
    gtValue = v
    return b
  }
  b.eq = (col: string, val: unknown) => {
    filters.push([col, val])
    return b
  }
  b.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res)
  return b
}

function stubDb(over: Partial<Fake> = {}): SupabaseClient {
  const f: Fake = {
    stages: ['new', 'contacted', 'quoted', 'deferred', 'no_response', 'traveling_soon'],
    contacts: [{ id: 'c1', client_id: CLIENT, stage_updated_at: STAGE_AT }],
    events: [{ contact_id: 'c1', changed_by: STAGE_INFER_ACTOR, to_stage: 'new', created_at: STAGE_AT }],
    touches: [{ contact_id: 'c1', channel: 'phone', metadata: { reached: true, talk_seconds: 39 } }],
    updated: 1,
    ...over,
  }
  updates = []
  audits = []
  filters = []
  gtValue = null
  limitValue = null
  const from = (table: string) => {
    if (table === 'client_pipeline_stages') {
      return chain(() => ({ data: f.stages.map((stage_key) => ({ stage_key, client_id: CLIENT })), error: null }))
    }
    if (table === 'contacts') {
      return {
        select: () =>
          chain(() => {
            const rows = f.contacts.filter((c) => gtValue === null || c.id > gtValue)
            return { data: limitValue === null ? rows : rows.slice(0, limitValue), error: null }
          }),
        update: (patch: Record<string, unknown>) => {
          updates.push(patch)
          return chain(() => ({ data: Array.from({ length: f.updated }, () => ({ id: 'c1' })), error: null }))
        },
      }
    }
    if (table === 'contact_stage_events') {
      return {
        select: () => chain(() => ({ data: f.events, error: null })),
        insert: (row: Record<string, unknown>) => {
          audits.push(row)
          return Promise.resolve({ error: f.auditErr ? { message: f.auditErr } : null })
        },
      }
    }
    if (table === 'contact_touchpoints') {
      return { select: () => chain(() => ({ data: f.touches, error: null })) }
    }
    throw new Error(`unexpected table ${table}`)
  }
  mocks.from.mockImplementation(from)
  return { from } as unknown as SupabaseClient
}

beforeEach(() => {
  mocks.from.mockReset()
})

describe('advanceNewLeadsAfterFollowUp', () => {
  it('also moves a contact the enquiry screen revived into new once a call is reached', async () => {
    const db = stubDb({
      events: [{ contact_id: 'c1', changed_by: ENQUIRY_REVIVE_ACTOR, to_stage: 'new', created_at: STAGE_AT }],
    })
    expect(await advanceNewLeadsAfterFollowUp(NOW, db)).toEqual({ candidates: 1, advanced: 1, failed: 0 })
  })

  it('moves an AI-placed new lead with a reached outbound call to contacted, with an audit row', async () => {
    const db = stubDb()
    const r = await advanceNewLeadsAfterFollowUp(NOW, db)
    expect(r).toEqual({ candidates: 1, advanced: 1, failed: 0 })
    expect(updates[0]).toMatchObject({ stage: 'contacted' })
    expect(audits[0]).toMatchObject({
      contact_id: 'c1',
      from_stage: 'new',
      to_stage: 'contacted',
      changed_by: CALL_REACHED_ACTOR,
    })
    expect(String(audits[0].note)).toContain('39 秒')
    // 写库时再判一次：阶段仍是 new、阶段时间没变
    expect(filters).toContainEqual(['stage', 'new'])
    expect(filters).toContainEqual(['stage_updated_at', STAGE_AT])
  })

  it('leaves a lead alone when a human set the stage', async () => {
    const db = stubDb({
      events: [{ contact_id: 'c1', changed_by: 'info@ctstours.co.nz', to_stage: 'new', created_at: STAGE_AT }],
    })
    const r = await advanceNewLeadsAfterFollowUp(NOW, db)
    expect(r.advanced).toBe(0)
    expect(updates).toHaveLength(0)
  })

  it('uses only the latest stage event (a later human change wins over an older AI one)', async () => {
    const db = stubDb({
      events: [
        { contact_id: 'c1', changed_by: 'info@ctstours.co.nz', to_stage: 'new', created_at: '2026-10-27T00:00:00Z' },
        { contact_id: 'c1', changed_by: STAGE_INFER_ACTOR, to_stage: 'new', created_at: STAGE_AT },
      ],
    })
    expect((await advanceNewLeadsAfterFollowUp(NOW, db)).advanced).toBe(0)
  })

  it('also advances when the customer picked up but hung up almost at once (answered, not reached)', async () => {
    const db = stubDb({ touches: [{ contact_id: 'c1', channel: 'phone', metadata: { reached: false, answered: true, talk_seconds: 0 } }] })
    expect((await advanceNewLeadsAfterFollowUp(NOW, db)).advanced).toBe(1)
    expect(audits[0].note).toContain('很快挂断')
  })

  it('does nothing for a call that just rang out (not answered, not reached)', async () => {
    const db = stubDb({ touches: [{ contact_id: 'c1', channel: 'phone', metadata: { reached: false, answered: false } }] })
    expect((await advanceNewLeadsAfterFollowUp(NOW, db)).advanced).toBe(0)
  })

  it('does nothing when no outbound call was reached', async () => {
    const db = stubDb({ touches: [{ contact_id: 'c1', channel: 'phone', metadata: { reached: false } }] })
    expect((await advanceNewLeadsAfterFollowUp(NOW, db)).advanced).toBe(0)
    const db2 = stubDb({ touches: [] })
    expect((await advanceNewLeadsAfterFollowUp(NOW, db2)).advanced).toBe(0)
    expect(updates).toHaveLength(0)
  })

  it('also advances when a colleague replied by email', async () => {
    const db = stubDb({ touches: [{ contact_id: 'c1', channel: 'email', source: 'microsoft_mail', metadata: null }] })
    expect((await advanceNewLeadsAfterFollowUp(NOW, db)).advanced).toBe(1)
    expect(String(audits[0].note)).toContain('同事已回过邮件')
  })

  it('ignores automated emails (auto-reply flag, bulk mail source)', async () => {
    const auto = stubDb({ touches: [{ contact_id: 'c1', channel: 'email', source: 'microsoft_mail', metadata: { automated: true } }] })
    expect((await advanceNewLeadsAfterFollowUp(NOW, auto)).advanced).toBe(0)
    const bulk = stubDb({ touches: [{ contact_id: 'c1', channel: 'email', source: 'mailchimp', metadata: null }] })
    expect((await advanceNewLeadsAfterFollowUp(NOW, bulk)).advanced).toBe(0)
  })

  it('pages past the first 200 new leads so a qualifying lead further down is not starved', async () => {
    const contacts = Array.from({ length: 450 }, (_, i) => ({
      id: `c${String(i).padStart(4, '0')}`,
      client_id: CLIENT,
      stage_updated_at: STAGE_AT,
    }))
    // 只有最后一位（第 3 页）有人跟进过
    const last = contacts[449].id
    const db = stubDb({
      contacts,
      events: contacts.map((c) => ({ contact_id: c.id, changed_by: STAGE_INFER_ACTOR, to_stage: 'new', created_at: STAGE_AT })),
      touches: [{ contact_id: last, channel: 'email', source: 'microsoft_mail', metadata: null }],
    })
    const r = await advanceNewLeadsAfterFollowUp(NOW, db)
    expect(r.candidates).toBe(450)
    expect(r.advanced).toBe(1)
  })

  it('skips a client whose pipeline has no contacted stage', async () => {
    // 缺 contacted 就不是「配齐」的客户，整个客户不在处理范围内
    const db = stubDb({ stages: ['new', 'quoted'] })
    const r = await advanceNewLeadsAfterFollowUp(NOW, db)
    expect(r).toEqual({ candidates: 0, advanced: 0, failed: 0 })
  })

  it('does not count it as advanced when a human changed the stage first (update hits 0 rows)', async () => {
    const db = stubDb({ updated: 0 })
    const r = await advanceNewLeadsAfterFollowUp(NOW, db)
    expect(r.advanced).toBe(0)
    expect(r.failed).toBe(0)
    expect(audits).toHaveLength(0)
  })

  it('rolls the stage back and reports failure when the audit row cannot be written', async () => {
    const db = stubDb({ auditErr: 'db down' })
    const r = await advanceNewLeadsAfterFollowUp(NOW, db)
    expect(r).toMatchObject({ advanced: 0, failed: 1 })
    expect(updates).toHaveLength(2)
    expect(updates[1]).toMatchObject({ stage: 'new', stage_updated_at: STAGE_AT })
  })
})
