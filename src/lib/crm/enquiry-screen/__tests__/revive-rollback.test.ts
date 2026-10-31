/**
 * 非咨询放回名单 + 一键回退 + 回退过的人永久不再判。
 * 钉死：只动机器判的（人标的不碰）· 只算判走之后入库的真消息 · 自动回复/打开点击/未接来电不算 ·
 * 写库带条件 · 留痕写不上就退回 · 回退演练不写库。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const mocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))

import { isRealInbound, reviveScreenedOnNewInbound } from '../revive'
import { rollbackScreenedContacts } from '../rollback'
import { checkEligibility } from '../eligibility'
import { DEFAULT_SCREEN_CONFIG } from '../types'
import { ENQUIRY_REVIVE_ACTOR, ENQUIRY_SCREEN_ACTOR, ENQUIRY_SCREEN_ROLLBACK_ACTOR } from '../../actors'

const NOW = new Date('2026-10-29T00:00:00Z')
const CLIENT = 'client-1'
const SCREENED_AT = '2026-10-20T00:00:00Z'
const AFTER = '2026-10-25T00:00:00Z'
const BEFORE = '2026-10-10T00:00:00Z'

interface FakeTouch {
  contact_id: string
  channel: string
  direction?: 'inbound' | 'outbound'
  source: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}
interface Fake {
  stages: string[]
  contacts: { id: string; client_id: string; stage_updated_at: string | null; do_not_contact?: boolean }[]
  events: { contact_id: string; from_stage: string | null; changed_by: string | null; to_stage: string | null; created_at: string }[]
  touches: FakeTouch[]
  updated: number
  auditErr?: string
}

let updates: Record<string, unknown>[]
let audits: Record<string, unknown>[]
let eqs: [string, unknown][]
let iss: string[]

/** 假数据库会真按 eq / is / gt / range 过滤 —— 否则删掉被测代码里的筛选条件，测试照样全绿。 */
function chain(rows: () => Record<string, unknown>[], onResult?: () => unknown) {
  const conds: ((r: Record<string, unknown>) => boolean)[] = []
  let range: [number, number] | null = null
  let desc: boolean | null = null
  let orderCol: string | null = null
  const b: Record<string, unknown> = {}
  const self = () => b
  for (const m of ['select', 'limit']) b[m] = self
  b.in = (c: string, vs: unknown[]) => {
    conds.push((r) => vs.includes(r[c]))
    return b
  }
  b.eq = (c: string, v: unknown) => {
    eqs.push([c, v])
    conds.push((r) => r[c] === v)
    return b
  }
  b.is = (c: string, v: unknown) => {
    iss.push(c)
    conds.push((r) => (r[c] ?? null) === v)
    return b
  }
  b.gt = (c: string, v: string) => {
    conds.push((r) => String(r[c]) > v)
    return b
  }
  b.order = (c: string, o?: { ascending?: boolean }) => {
    if (orderCol === null) {
      orderCol = c
      desc = o?.ascending === false
    }
    return b
  }
  b.range = (f: number, t: number) => {
    range = [f, t]
    return b
  }
  b.then = (res: (v: unknown) => unknown) => {
    if (onResult) return Promise.resolve(onResult()).then(res)
    let out = rows().filter((r) => conds.every((c) => c(r)))
    if (orderCol) {
      const col = orderCol
      out = [...out].sort((x, y) => (String(x[col]) < String(y[col]) ? -1 : String(x[col]) > String(y[col]) ? 1 : 0))
      if (desc) out.reverse()
    }
    if (range) out = out.slice(range[0], range[1] + 1)
    return Promise.resolve({ data: out, error: null }).then(res)
  }
  return b
}

function stubDb(over: Partial<Fake> = {}): SupabaseClient {
  const f: Fake = {
    stages: ['new', 'not_enquiry'],
    contacts: [{ id: 'c1', client_id: CLIENT, stage_updated_at: SCREENED_AT }],
    events: [{ contact_id: 'c1', from_stage: 'new', changed_by: ENQUIRY_SCREEN_ACTOR, to_stage: 'not_enquiry', created_at: SCREENED_AT }],
    touches: [{ contact_id: 'c1', channel: 'email', source: 'microsoft_mail', metadata: { subject: 'Hi, 2 pax March?' }, created_at: AFTER }],
    updated: 1,
    ...over,
  }
  updates = []
  audits = []
  eqs = []
  iss = []
  const from = (table: string) => {
    if (table === 'client_pipeline_stages') {
      return chain(() => f.stages.map((stage_key) => ({ stage_key, client_id: CLIENT })))
    }
    if (table === 'contacts') {
      return {
        select: () => chain(() => f.contacts.map((c) => ({ do_not_contact: false, stage: 'not_enquiry', ...c }))),
        update: (patch: Record<string, unknown>) => {
          updates.push(patch)
          return chain(() => [], () => ({ data: Array.from({ length: f.updated }, () => ({ id: 'c1' })), error: null }))
        },
      }
    }
    if (table === 'contact_stage_events') {
      return {
        select: () => chain(() => f.events),
        insert: (row: Record<string, unknown>) => {
          audits.push(row)
          return Promise.resolve({ error: f.auditErr ? { message: f.auditErr } : null })
        },
      }
    }
    if (table === 'contact_touchpoints') {
      return { select: () => chain(() => f.touches.map((t) => ({ direction: 'inbound', ...t }))) }
    }
    throw new Error(`unexpected table ${table}`)
  }
  mocks.from.mockImplementation(from)
  return { from } as unknown as SupabaseClient
}

beforeEach(() => {
  mocks.from.mockReset()
})

describe('isRealInbound', () => {
  it('counts a plain email, an enquiry form, a messenger message and a connected call', () => {
    expect(isRealInbound({ channel: 'email', source: 'microsoft_mail', metadata: { subject: 'Price?' } })).toBe(true)
    expect(isRealInbound({ channel: 'messenger', source: 'messenger', metadata: null })).toBe(true)
    expect(isRealInbound({ channel: 'phone', source: 'twilio', metadata: { reached: true } })).toBe(true)
    // 客人打进来的电话：reached 恒为 false，聊上了的标记是 outcome='spoke'
    expect(isRealInbound({ channel: 'phone', source: 'voipline', metadata: { reached: false, outcome: 'spoke' } })).toBe(true)
  })
  it('does not count auto-replies, mailchimp opens/clicks, automated or unanswered calls', () => {
    expect(isRealInbound({ channel: 'email', source: 'microsoft_mail', metadata: { subject: 'Automatic reply: away' } })).toBe(false)
    expect(isRealInbound({ channel: 'email', source: 'mailchimp', metadata: null })).toBe(false)
    expect(isRealInbound({ channel: 'email', source: 'microsoft_mail', metadata: { email_opened: true } })).toBe(false)
    expect(isRealInbound({ channel: 'phone', source: 'twilio', metadata: { reached: false } })).toBe(false)
    expect(isRealInbound({ channel: 'phone', source: 'voipline', metadata: { reached: false, outcome: 'missed_inbound' } })).toBe(false)
    expect(isRealInbound({ channel: 'email', source: 'microsoft_mail', metadata: { automated: true } })).toBe(false)
  })
  it('does not count a call the analysis says the customer never spoke on (voicemail / silence)', () => {
    expect(isRealInbound({ channel: 'phone', source: 'twilio', metadata: { reached: true, outcome: 'spoke', customer_spoke: 'no' } })).toBe(false)
    expect(isRealInbound({ channel: 'phone', source: 'twilio', metadata: { reached: true, outcome: 'spoke', customer_spoke: 'yes' } })).toBe(true)
    // 分析还没出结果：照旧（不藏人）
    expect(isRealInbound({ channel: 'phone', source: 'twilio', metadata: { reached: true, outcome: 'spoke' } })).toBe(true)
  })
})

describe('reviveScreenedOnNewInbound', () => {
  it('puts a machine-screened contact back to new when a real message arrived after the screening, with audit', async () => {
    const db = stubDb()
    const r = await reviveScreenedOnNewInbound(NOW, db)
    expect(r).toEqual({ candidates: 1, revived: 1, failed: 0 })
    expect(updates[0]).toMatchObject({ stage: 'new' })
    expect(eqs).toContainEqual(['stage', 'not_enquiry'])
    expect(audits[0]).toMatchObject({ from_stage: 'not_enquiry', to_stage: 'new', changed_by: ENQUIRY_REVIVE_ACTOR })
  })

  it('does nothing when the only message is older than the screening (late-synced old mail is not new)', async () => {
    const db = stubDb({ touches: [{ contact_id: 'c1', channel: 'email', source: 'microsoft_mail', metadata: null, created_at: BEFORE }] })
    expect(await reviveScreenedOnNewInbound(NOW, db)).toEqual({ candidates: 1, revived: 0, failed: 0 })
    expect(updates).toHaveLength(0)
  })

  it('never touches a not_enquiry a human set (latest stage change is not the machine screen)', async () => {
    const db = stubDb({ events: [{ contact_id: 'c1', from_stage: 'new', changed_by: 'staff@example.com', to_stage: 'not_enquiry', created_at: SCREENED_AT }] })
    expect((await reviveScreenedOnNewInbound(NOW, db)).revived).toBe(0)
    expect(updates).toHaveLength(0)
  })

  it('ignores an auto-reply that arrived after the screening', async () => {
    const db = stubDb({ touches: [{ contact_id: 'c1', channel: 'email', source: 'microsoft_mail', metadata: { subject: 'Out of office' }, created_at: AFTER }] })
    expect((await reviveScreenedOnNewInbound(NOW, db)).revived).toBe(0)
  })

  it('skips clients whose pipeline has no not_enquiry or no new stage', async () => {
    const db = stubDb({ stages: ['new'] })
    expect(await reviveScreenedOnNewInbound(NOW, db)).toEqual({ candidates: 0, revived: 0, failed: 0 })
  })

  it('counts a staff-won race as neither revived nor failed', async () => {
    const db = stubDb({ updated: 0 })
    expect(await reviveScreenedOnNewInbound(NOW, db)).toEqual({ candidates: 1, revived: 0, failed: 0 })
    expect(audits).toHaveLength(0)
  })

  it('rolls the stage back when the audit row cannot be written', async () => {
    const db = stubDb({ auditErr: 'boom' })
    const r = await reviveScreenedOnNewInbound(NOW, db)
    expect(r).toEqual({ candidates: 1, revived: 0, failed: 1 })
    expect(updates.at(-1)).toMatchObject({ stage: 'not_enquiry' })
  })
})

describe('rollbackScreenedContacts', () => {
  it('dry run reports the plan and writes nothing', async () => {
    const db = stubDb()
    const r = await rollbackScreenedContacts(db, CLIENT, { apply: false })
    expect(r).toMatchObject({ planned: 1, restored: 0, skipped: 0 })
    expect(r.items[0]).toMatchObject({ contactId: 'c1', restoreTo: 'new' })
    expect(updates).toHaveLength(0)
    expect(audits).toHaveLength(0)
  })

  it('apply restores to the recorded from_stage with a conditional update and a rollback audit', async () => {
    const db = stubDb()
    const r = await rollbackScreenedContacts(db, CLIENT, { apply: true })
    expect(r).toMatchObject({ planned: 1, restored: 1 })
    expect(updates[0]).toMatchObject({ stage: 'new' })
    expect(eqs).toContainEqual(['stage', 'not_enquiry'])
    expect(audits[0]).toMatchObject({ from_stage: 'not_enquiry', to_stage: 'new', changed_by: ENQUIRY_SCREEN_ROLLBACK_ACTOR })
  })

  it('restores an originally empty stage back to empty', async () => {
    const db = stubDb({ events: [{ contact_id: 'c1', from_stage: null, changed_by: ENQUIRY_SCREEN_ACTOR, to_stage: 'not_enquiry', created_at: SCREENED_AT }] })
    await rollbackScreenedContacts(db, CLIENT, { apply: true })
    expect(updates[0]).toMatchObject({ stage: null })
  })

  it('leaves human-set not_enquiry alone', async () => {
    const db = stubDb({ events: [{ contact_id: 'c1', from_stage: 'new', changed_by: 'staff@example.com', to_stage: 'not_enquiry', created_at: SCREENED_AT }] })
    const r = await rollbackScreenedContacts(db, CLIENT, { apply: true })
    expect(r.planned).toBe(0)
    expect(updates).toHaveLength(0)
  })

  it('skips (not fails) when someone changed the stage in between', async () => {
    const db = stubDb({ updated: 0 })
    expect(await rollbackScreenedContacts(db, CLIENT, { apply: true })).toMatchObject({ planned: 1, restored: 0, skipped: 1 })
    expect(audits).toHaveLength(0)
  })
})

describe('reviveScreenedOnNewInbound · filters the fake db really applies', () => {
  it('does not revive a contact marked do-not-contact', async () => {
    const db = stubDb({ contacts: [{ id: 'c1', client_id: CLIENT, stage_updated_at: SCREENED_AT, do_not_contact: true }] })
    expect(await reviveScreenedOnNewInbound(NOW, db)).toEqual({ candidates: 0, revived: 0, failed: 0 })
    expect(updates).toHaveLength(0)
  })

  it('does not revive on an outbound message (staff replied)', async () => {
    const db = stubDb({ touches: [{ contact_id: 'c1', channel: 'email', direction: 'outbound', source: 'microsoft_mail', metadata: null, created_at: AFTER }] })
    expect((await reviveScreenedOnNewInbound(NOW, db)).revived).toBe(0)
  })

  it('revives on a customer call that was picked up and spoken (inbound, outcome=spoke)', async () => {
    const db = stubDb({ touches: [{ contact_id: 'c1', channel: 'phone', source: 'voipline', metadata: { reached: false, outcome: 'spoke' }, created_at: AFTER }] })
    expect((await reviveScreenedOnNewInbound(NOW, db)).revived).toBe(1)
  })

  it('finds the one real message even when more than a page (1000) of newsletters precede it', async () => {
    const noise: FakeTouch[] = Array.from({ length: 1200 }, (_, i) => ({
      contact_id: 'c1',
      channel: 'email',
      source: 'microsoft_mail',
      metadata: { subject: 'Automatic reply: away' },
      created_at: `2026-10-21T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z`,
    }))
    const real: FakeTouch = { contact_id: 'c1', channel: 'email', source: 'microsoft_mail', metadata: { subject: 'Quote for 2 pax?' }, created_at: '2026-10-28T00:00:00Z' }
    const db = stubDb({ touches: [...noise, real] })
    expect((await reviveScreenedOnNewInbound(NOW, db)).revived).toBe(1)
  })
})

describe('rollbackScreenedContacts · empty original stage', () => {
  it('when the audit row fails, the undo matches "stage is null", not "stage = null"', async () => {
    const db = stubDb({
      auditErr: 'boom',
      events: [{ contact_id: 'c1', from_stage: null, changed_by: ENQUIRY_SCREEN_ACTOR, to_stage: 'not_enquiry', created_at: SCREENED_AT }],
    })
    await expect(rollbackScreenedContacts(db, CLIENT, { apply: true })).rejects.toThrow(/已把阶段退回/)
    expect(iss).toContain('stage')
    expect(updates.at(-1)).toMatchObject({ stage: 'not_enquiry' })
  })
})

describe('rolled-back contacts are never screened again', () => {
  it('a rollback event makes the contact ineligible even though the rollback actor is a machine', () => {
    const verdict = checkEligibility({
      contact: { id: 'c1', stage: 'new', doNotContact: false, emails: ['x@example.com'], hasPhone: false },
      touches: [{ channel: 'email', source: 'microsoft_mail', direction: 'inbound', occurredAt: BEFORE, createdAt: BEFORE, subject: 's', preview: 'p' }],
      events: [
        { fromStage: 'new', toStage: 'not_enquiry', changedBy: ENQUIRY_SCREEN_ACTOR, createdAt: SCREENED_AT },
        { fromStage: 'not_enquiry', toStage: 'new', changedBy: ENQUIRY_SCREEN_ROLLBACK_ACTOR, createdAt: AFTER },
      ],
      contactKind: 'retail',
      hasNotEnquiryStage: true,
      config: { ...DEFAULT_SCREEN_CONFIG, enabled: true },
      now: NOW,
    })
    expect(verdict).toEqual({ eligible: false, why: 'rolled_back' })
  })
})
