import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/require-admin', () => ({ requireGlobalAdmin: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { GET, POST } from '../route'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { supabaseAdmin } from '@/lib/supabase'

const CLIENT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const admin = vi.mocked(requireGlobalAdmin)
const from = vi.mocked(supabaseAdmin.from)

let leads: unknown
let updates: unknown[]
let logs: Array<Record<string, unknown>>
let readError = false
let missing = false
let updateFails = false
let logFails = false

function installDb() {
  from.mockImplementation(((table: string) => {
    if (table === 'clients') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              if (readError) return { data: null, error: { message: 'db' } }
              if (missing) return { data: null, error: null }
              return { data: { id: CLIENT, leads_config: leads }, error: null }
            },
          }),
        }),
        update: (row: { leads_config: unknown }) => ({
          eq: async () => {
            updates.push(row.leads_config)
            if (updateFails) return { error: { message: 'db' } }
            leads = row.leads_config
            return { error: null }
          },
        }),
      }
    }
    if (table === 'fde_work_logs') {
      return {
        insert: async (row: Record<string, unknown>) => {
          if (logFails) return { error: { message: 'db' } }
          logs.push(row)
          return { error: null }
        },
      }
    }
    throw new Error(`unexpected table ${table}`)
  }) as never)
}

function post(body: unknown) {
  return POST(new Request('http://localhost/switches', { method: 'POST', body: JSON.stringify(body) }), {
    params: { id: CLIENT },
  })
}

beforeEach(() => {
  leads = { mailchimp_enabled: true, ads_trend_check: { ctr_drop_pct: 25 } }
  updates = []
  logs = []
  readError = false
  missing = false
  updateFails = false
  logFails = false
  admin.mockResolvedValue({ ok: true, user: { email: 'Ray@Example.test' } } as never)
  installDb()
})

describe('automation switches route', () => {
  it('hides the switches from anyone who is not an internal admin', async () => {
    admin.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    const res = await GET(new Request('http://localhost/switches'), { params: { id: CLIENT } })
    expect(res.status).toBe(403)
    expect(from).not.toHaveBeenCalled()
  })

  it('reads the current switches and leaves other fields alone', async () => {
    leads = { mailchimp_enabled: true, ads_trend_check: { enabled: true } }
    const res = await GET(new Request('http://localhost/switches'), { params: { id: CLIENT } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      switches: { ads_predictive_early_warning: false, ads_trend_check: true, ads_tune_cards: false },
    })
  })

  it('rejects a portal-shaped body before writing', async () => {
    const res = await post({ ads_tune_cards: true, daily_budget_cap_cents: 100 })
    expect(res.status).toBe(400)
    expect(updates).toEqual([])
    expect(logs).toEqual([])
  })

  it('merges one switch, keeps the rest, and writes a work log', async () => {
    const res = await post({ ads_trend_check: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      switches: { ads_predictive_early_warning: false, ads_trend_check: true, ads_tune_cards: false },
      auditWarning: null,
    })
    expect(leads).toEqual({
      mailchimp_enabled: true,
      ads_trend_check: { ctr_drop_pct: 25, enabled: true },
    })
    expect(logs).toEqual([
      expect.objectContaining({
        client_id: CLIENT,
        author_email: 'ray@example.test',
        summary: '【Meta 广告】广告自动化开关：日趋势检查 关→开。',
      }),
    ])
  })

  it('rolls the switch back when the work log cannot be written', async () => {
    logFails = true
    const res = await post({ ads_tune_cards: true })
    expect(res.status).toBe(500)
    expect(leads).toEqual({ mailchimp_enabled: true, ads_trend_check: { ctr_drop_pct: 25 } })
    expect(logs).toEqual([])
    expect(updates).toHaveLength(2)
  })

  it('does not write a log when the value is already the same', async () => {
    const res = await post({ ads_predictive_early_warning: false })
    expect(res.status).toBe(200)
    expect(logs).toEqual([])
    expect(updates).toEqual([])
  })
})
