import { beforeEach, describe, expect, it, vi } from 'vitest'

const send = vi.hoisted(() => vi.fn(async () => ({ status: 'confirmed', message: '已发给广告平台。', writebackId: 'wb-1' })))
vi.mock('../writeback-service', () => ({ sendApprovedOutcome: send }))
vi.mock('@/lib/meta/capi/writer', () => ({ metaCapiWriter: { kind: 'meta_capi' } }))

import { recordQualifiedStageLead } from '../crm-qualified-lead'

const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CONTACT = '11111111-2222-3333-4444-555555555555'
const LEAD = '1687504185706630'

type Row = Record<string, unknown>

function fakeDb() {
  const tables: Record<string, Row[]> = {
    clients: [],
    contacts: [],
    contact_touchpoints: [],
    me_sale_outcomes: [],
    me_conversion_audit: [],
    me_conversion_writebacks: [],
  }
  return {
    tables,
    from(table: string) {
      const filters: Array<[string, unknown]> = []
      const chain = {
        select() { return chain },
        eq(column: string, value: unknown) {
          filters.push([column, value])
          return chain
        },
        maybeSingle: async () => ({ data: matched()[0] ?? null, error: null }),
        then(resolve: (value: { data: Row[]; error: null }) => unknown) {
          return Promise.resolve(resolve({ data: matched(), error: null }))
        },
        insert(row: Row) {
          if (table !== 'me_sale_outcomes') {
            tables[table].push(row)
            return Promise.resolve({ error: null })
          }
          const dup = tables[table].some((saved) => saved.client_id === row.client_id && saved.source_ref === row.source_ref)
          if (dup) {
            return { select: () => ({ single: async () => ({ data: null, error: { code: '23505', message: 'dup' } }) }) }
          }
          const stored = { id: `out-${tables[table].length + 1}`, ...row }
          tables[table].push(stored)
          return { select: () => ({ single: async () => ({ data: { id: stored.id }, error: null }) }) }
        },
      }
      function matched(): Row[] {
        return (tables[table] ?? []).filter((row) => filters.every(([column, value]) => row[column] === value))
      }
      return chain
    },
  }
}

function liveClient(over: Row = {}) {
  return {
    id: CLIENT,
    conversion_stage: 'live',
    default_phone_country: '64',
    leads_config: {
      capi_conversion_leads: true,
      capi_qualified_lead_stage_key: 'quoted',
      capi_conversion_deal_stage_key: 'balance_received',
    },
    ...over,
  }
}

beforeEach(() => { send.mockClear() })

describe('recordQualifiedStageLead', () => {
  it('does nothing when the switch is off', async () => {
    const db = fakeDb()
    db.tables.clients.push(liveClient({ leads_config: {} }))
    const result = await recordQualifiedStageLead(db as never, {
      clientId: CLIENT, contactId: CONTACT, stageKey: 'quoted', actor: 'roman@example.com',
    })
    expect(result.attempted).toBe(false)
    expect(db.tables.me_sale_outcomes).toHaveLength(0)
    expect(send).not.toHaveBeenCalled()
  })

  it('records an approved lead step and sends it when the form id is present', async () => {
    const db = fakeDb()
    db.tables.clients.push(liveClient())
    db.tables.contacts.push({ id: CONTACT, client_id: CLIENT, primary_email: 'a@b.co' })
    db.tables.contact_touchpoints.push(
      { contact_id: CONTACT, client_id: CLIENT, source: 'meta_lead_form', source_ref: '111111111111111', occurred_at: '2026-10-01T00:00:00.000Z' },
      { contact_id: CONTACT, client_id: CLIENT, source: 'meta_lead_form', source_ref: LEAD, occurred_at: '2026-10-02T00:00:00.000Z' },
    )
    const result = await recordQualifiedStageLead(db as never, {
      clientId: CLIENT, contactId: CONTACT, stageKey: 'quoted', actor: 'roman@example.com',
    })
    expect(result.message).toContain('已发给广告平台')
    const row = db.tables.me_sale_outcomes[0]
    expect(row.review_status).toBe('approved')
    expect(row.reviewed_by).toBe('system:crm-qualified-lead')
    expect(row.source_ref).toBe(`crm_qualified:${CONTACT}:quoted`)
    expect(row.outcome_kind).toBe('lead')
    expect(row.meta_lead_id).toBe(LEAD)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('does not insert again for the same contact and stage', async () => {
    const db = fakeDb()
    db.tables.clients.push(liveClient())
    db.tables.contacts.push({ id: CONTACT, client_id: CLIENT, primary_email: 'a@b.co' })
    db.tables.contact_touchpoints.push({ contact_id: CONTACT, client_id: CLIENT, source: 'meta_lead_form', source_ref: LEAD })
    const input = { clientId: CLIENT, contactId: CONTACT, stageKey: 'quoted', actor: 'ai:conversation-read' }
    await recordQualifiedStageLead(db as never, input)
    db.tables.me_conversion_writebacks.push({
      outcome_id: db.tables.me_sale_outcomes[0].id,
      destination: 'meta_capi',
      event_id: db.tables.me_sale_outcomes[0].id,
      status: 'confirmed',
    })
    const again = await recordQualifiedStageLead(db as never, input)
    expect(again.message).toContain('已经记过')
    expect(db.tables.me_sale_outcomes).toHaveLength(1)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('retries a failed send once and does not insert a second row', async () => {
    const db = fakeDb()
    db.tables.clients.push(liveClient())
    db.tables.contacts.push({ id: CONTACT, client_id: CLIENT, primary_email: 'a@b.co' })
    db.tables.contact_touchpoints.push({ contact_id: CONTACT, client_id: CLIENT, source: 'meta_lead_form', source_ref: LEAD })
    const input = { clientId: CLIENT, contactId: CONTACT, stageKey: 'quoted', actor: 'ai:conversation-read' }
    await recordQualifiedStageLead(db as never, input)
    db.tables.me_conversion_writebacks.push({
      outcome_id: db.tables.me_sale_outcomes[0].id,
      destination: 'meta_capi',
      event_id: db.tables.me_sale_outcomes[0].id,
      status: 'failed',
    })
    send.mockClear()
    const again = await recordQualifiedStageLead(db as never, input)
    expect(again.message).toContain('已发给广告平台')
    expect(db.tables.me_sale_outcomes).toHaveLength(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toBe(db.tables.me_sale_outcomes[0].id)
  })

  it('states why a lead with no form id is not sent, and does not send an ordinary lead', async () => {
    const db = fakeDb()
    db.tables.clients.push(liveClient())
    db.tables.contacts.push({ id: CONTACT, client_id: CLIENT, primary_email: 'a@b.co' })
    const result = await recordQualifiedStageLead(db as never, {
      clientId: CLIENT, contactId: CONTACT, stageKey: 'quoted', actor: 'roman@example.com',
    })
    expect(result.attempted).toBe(true)
    expect(result.message).toContain('没有原始线索编号')
    expect(result.message).toContain('普通咨询')
    expect(db.tables.me_sale_outcomes).toHaveLength(0)
    expect(send).not.toHaveBeenCalled()
  })
})
