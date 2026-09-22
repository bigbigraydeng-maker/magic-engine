/**
 * `runCtsCrmSync` 编排层测试——假 Sheets 数据 + 按表建模的假 Supabase（跟
 * `writeback-service.test.ts` 同一原则：真的存行、真的执行唯一约束语义，
 * 不是按调用顺序返回预设值）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { runCtsCrmSync } from '../cts-crm-sheet-sync-run'

const sheet1Fixture = vi.fn()
const crmFixture = vi.fn()

vi.mock('@/lib/google-sheets/client', () => ({
  readSheetValues: (_clientId: string, _spreadsheetId: string, range: string) => {
    if (range.startsWith('Sheet1')) return Promise.resolve(sheet1Fixture())
    return Promise.resolve(crmFixture())
  },
}))

// ── Sheet1 行构造：B=1 created_time, N=13 email, O=14 full_name, P=15 phone, R=17 notes ──
function sheet1Row(opts: {
  createdTime?: string
  email?: string
  fullName?: string
  phone?: string
  notes?: string
}): string[] {
  const row = new Array(18).fill('')
  row[1] = opts.createdTime ?? ''
  row[13] = opts.email ?? ''
  row[14] = opts.fullName ?? ''
  row[15] = opts.phone ?? ''
  row[17] = opts.notes ?? ''
  return row
}

// ── CRM管理 行构造：A=0 entryDate, C=2 phone, E=4 tour, G=6 stage, H=7 stageUpdatedDate ──
function crmRow(opts: {
  entryDate?: string
  phone?: string
  tour?: string
  stage?: string
  stageUpdatedDate?: string
}): string[] {
  const row = new Array(8).fill('')
  row[0] = opts.entryDate ?? ''
  row[2] = opts.phone ?? ''
  row[4] = opts.tour ?? ''
  row[6] = opts.stage ?? ''
  row[7] = opts.stageUpdatedDate ?? ''
  return row
}

// ── 按表建模的假 Supabase ──────────────────────────────────────────────────
type Row = Record<string, unknown>

function fakeSupabase(seed: { contactIdentities?: Row[]; groupTours?: Row[] } = {}): {
  client: SupabaseClient
  outcomes: Row[]
  audits: Row[]
} {
  const outcomes: Row[] = []
  const audits: Row[] = []
  const contactIdentities = seed.contactIdentities ?? []
  const groupTours = seed.groupTours ?? []

  const client = {
    from(table: string) {
      if (table === 'contact_identities') {
        // 实测核实：cts-crm-sheet-sync-run.ts 对这张表只调用
        // .select('contact_id, kind, value').eq('client_id', ...).in('value', [...])
        // （源码第 114-117 行），不调用其他方法。
        return {
          select: () => ({
            eq: () => ({
              in: async (_col: string, values: string[]) => ({
                data: contactIdentities.filter((r) => values.includes(r.value as string)),
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'group_tours') {
        // 实测核实：cts-tour-price.ts 对这张表只调用
        // .select('payload').eq('client_id', ...).eq('status', 'published')（第 47-50 行）。
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({ data: groupTours, error: null }),
            }),
          }),
        }
      }
      if (table === 'me_sale_outcomes') {
        // 实测核实：insertOutcome() 对这张表只调用
        // .insert(row).select('id').single()（cts-crm-sheet-sync-run.ts 第 144 行）。
        return {
          insert: (row: Row) => ({
            select: () => ({
              single: async () => {
                const dup = outcomes.some(
                  (r) => r.client_id === row.client_id && r.source_kind === row.source_kind && r.source_ref === row.source_ref,
                )
                if (dup) {
                  return { data: null, error: { code: '23505', message: 'duplicate key' } }
                }
                const id = `outcome-${outcomes.length + 1}`
                outcomes.push({ id, ...row })
                return { data: { id }, error: null }
              },
            }),
          }),
        }
      }
      if (table === 'me_conversion_audit') {
        // 实测核实：insertOutcome() 对这张表只 `await supabase.from(...).insert({...})`，
        // 不接 .select() 等其他方法（源码第 156 行）。
        return { insert: async (row: Row) => { audits.push(row); return { data: null, error: null } } }
      }
      throw new Error(`unexpected table in test: ${table}`)
    },
    // 假件只实现上面四张表用到的方法，用 unknown 中转是因为按调用链建模、不是
    // 实现完整 SupabaseClient 接口——四条链均已逐一对着源码核实（见各分支注释）。
  } as unknown as SupabaseClient

  return { client, outcomes, audits }
}

beforeEach(() => {
  sheet1Fixture.mockReset()
  crmFixture.mockReset()
})

describe('runCtsCrmSync', () => {
  it('inserts a qualified lead, using Sheet1 created_time as occurredAt', async () => {
    sheet1Fixture.mockReturnValue([sheet1Row({ createdTime: '2026-06-14T02:39:49-05:00', phone: 'p:+6421363598', email: 'jane@example.com', fullName: 'Jane Doe' })])
    crmFixture.mockReturnValue([crmRow({ entryDate: '14/06/2026', phone: 'p:+6421363598', tour: 'Best of China 15D' })])

    const { client, outcomes, audits } = fakeSupabase()
    const summary = await runCtsCrmSync({ supabase: client })

    expect(summary.insertedLeads).toBe(1)
    expect(summary.contactNotLinked).toBe(1) // 没有预置任何 contact_identities
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]).toMatchObject({ outcome_kind: 'lead', source_kind: 'crm_sheet_sync' })
    expect(audits).toHaveLength(1)
  })

  it('links an existing contact via contact_identities and leaves contactNotLinked at 0', async () => {
    sheet1Fixture.mockReturnValue([sheet1Row({ createdTime: '2026-06-14T02:39:49-05:00', phone: 'p:+6421363598' })])
    crmFixture.mockReturnValue([crmRow({ entryDate: '14/06/2026', phone: 'p:+6421363598', tour: 'Best of China 15D' })])

    const { client, outcomes } = fakeSupabase({
      contactIdentities: [{ contact_id: '11111111-2222-3333-4444-555555555555', kind: 'phone', value: '+6421363598' }],
    })
    const summary = await runCtsCrmSync({ supabase: client })

    expect(summary.contactNotLinked).toBe(0)
    expect(outcomes[0]).toMatchObject({ contact_id: '11111111-2222-3333-4444-555555555555' })
  })

  it('excludes a row whose Sheet1 notes say wrong number, even though the stale CRM管理 copy looks clean', async () => {
    sheet1Fixture.mockReturnValue([sheet1Row({ createdTime: '2026-06-14T02:39:49-05:00', phone: 'p:+6421363598', notes: 'wrong number' })])
    crmFixture.mockReturnValue([crmRow({ entryDate: '14/06/2026', phone: 'p:+6421363598' })])

    const { client, outcomes } = fakeSupabase()
    const summary = await runCtsCrmSync({ supabase: client })

    expect(summary.excludedByNotes).toBe(1)
    expect(outcomes).toHaveLength(0)
  })

  it('holds a purchase-staged row for manual review when stageUpdatedDate is blank', async () => {
    sheet1Fixture.mockReturnValue([sheet1Row({ phone: 'p:+6421363598' })])
    crmFixture.mockReturnValue([crmRow({ phone: 'p:+6421363598', tour: 'Best of China 15D', stage: '4-已订金' })])

    const { client, outcomes } = fakeSupabase()
    const summary = await runCtsCrmSync({ supabase: client })

    expect(summary.heldForManualReview).toHaveLength(1)
    expect(summary.heldForManualReview[0].reason).toContain('阶段更新日')
    expect(outcomes).toHaveLength(0)
  })

  it('resolves price from group_tours and inserts a purchase once stageUpdatedDate is present', async () => {
    sheet1Fixture.mockReturnValue([sheet1Row({ phone: 'p:+6421363598' })])
    crmFixture.mockReturnValue([
      crmRow({ phone: 'p:+6421363598', tour: 'Golden China Tour', stage: '4-已订金', stageUpdatedDate: '01/07/2026' }),
    ])

    const { client, outcomes } = fakeSupabase({
      groupTours: [{ payload: { name: 'Golden China Tour', price: 'From NZD $4,999 per person' } }],
    })
    const summary = await runCtsCrmSync({ supabase: client })

    expect(summary.insertedPurchases).toBe(1)
    expect(outcomes[0]).toMatchObject({ outcome_kind: 'purchase', currency: 'NZD', amount_minor: 499900 })
  })

  it('holds a purchase for manual review when no price can be found — does not fabricate an amount', async () => {
    sheet1Fixture.mockReturnValue([sheet1Row({ phone: 'p:+6421363598' })])
    crmFixture.mockReturnValue([
      crmRow({ phone: 'p:+6421363598', tour: 'Unknown Tour Name', stage: '4-已订金', stageUpdatedDate: '01/07/2026' }),
    ])

    const { client, outcomes } = fakeSupabase({ groupTours: [] })
    const summary = await runCtsCrmSync({ supabase: client })

    expect(summary.insertedPurchases).toBe(0)
    expect(summary.heldForManualReview).toHaveLength(1)
    expect(outcomes).toHaveLength(0)
  })

  it('is idempotent: running twice does not insert the same lead twice', async () => {
    sheet1Fixture.mockReturnValue([sheet1Row({ createdTime: '2026-06-14T02:39:49-05:00', phone: 'p:+6421363598' })])
    crmFixture.mockReturnValue([crmRow({ entryDate: '14/06/2026', phone: 'p:+6421363598', tour: 'Best of China 15D' })])

    const { client, outcomes } = fakeSupabase()
    const first = await runCtsCrmSync({ supabase: client })
    const second = await runCtsCrmSync({ supabase: client })

    expect(first.insertedLeads).toBe(1)
    expect(second.insertedLeads).toBe(0)
    expect(second.skippedAlreadySynced).toBe(1)
    expect(outcomes).toHaveLength(1)
  })

  it('does not let a same-phone repurchase of a different tour collide with an earlier purchase', async () => {
    sheet1Fixture.mockReturnValue([sheet1Row({ phone: 'p:+6421363598' })])
    crmFixture.mockReturnValueOnce([
      crmRow({ phone: 'p:+6421363598', tour: 'Golden China Tour', stage: '4-已订金', stageUpdatedDate: '01/07/2026' }),
    ])

    const { client, outcomes } = fakeSupabase({
      groupTours: [
        { payload: { name: 'Golden China Tour', price: 'From NZD $4,999 per person' } },
        { payload: { name: 'Silk Road 18D', price: 'From NZD $6,999 per person' } },
      ],
    })
    await runCtsCrmSync({ supabase: client })

    crmFixture.mockReturnValueOnce([
      crmRow({ phone: 'p:+6421363598', tour: 'Silk Road 18D', stage: '4-已订金', stageUpdatedDate: '02/07/2026' }),
    ])
    const second = await runCtsCrmSync({ supabase: client })

    expect(second.insertedPurchases).toBe(1)
    expect(second.skippedAlreadySynced).toBe(0)
    expect(outcomes).toHaveLength(2)
  })

  it('stops inserting once maxInsertsPerRun is reached and reports the cap', async () => {
    sheet1Fixture.mockReturnValue([
      sheet1Row({ createdTime: '2026-06-14T02:39:49-05:00', phone: 'p:+6421363001' }),
      sheet1Row({ createdTime: '2026-06-14T02:39:49-05:00', phone: 'p:+6421363002' }),
    ])
    crmFixture.mockReturnValue([
      crmRow({ entryDate: '14/06/2026', phone: 'p:+6421363001', tour: 'Best of China 15D' }),
      crmRow({ entryDate: '14/06/2026', phone: 'p:+6421363002', tour: 'Best of China 15D' }),
    ])

    const { client, outcomes } = fakeSupabase()
    const summary = await runCtsCrmSync({ supabase: client, maxInsertsPerRun: 1 })

    expect(summary.insertedLeads).toBe(1)
    expect(summary.cappedAtMaxInserts).toBe(true)
    expect(outcomes).toHaveLength(1)
  })
})
