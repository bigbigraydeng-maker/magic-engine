/**
 * G11 wiring — clients.industry must actually reach the words the PM reads.
 *
 * playbooks.test.ts proves the pure functions change words when handed an
 * industry. That is not enough: 魏征 (2026-09-14) set every "pass industry"
 * call site back to null and the whole suite stayed green (6 surviving
 * mutants). These tests drive the two I/O entry points end to end — the daily
 * evaluation (writes the narrative the dashboard shows) and the digest email —
 * with a table-modelled fake database, and assert on the final artefact.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type Row = Record<string, unknown>
type DbError = { message: string } | null

const h = vi.hoisted(() => {
  const db = {
    insights: [] as Row[],
    clientIndustry: null as string | null,
    clientError: null as DbError,
    narrative: null as Row | null,
    upserts: [] as Row[],
  }
  const sendMock = vi.fn()

  /** One chainable query per call, answering by table (not by call order). */
  function query(table: string) {
    let columns = ''
    const q = {
      select(cols: string) { columns = cols; return q },
      eq() { return q },
      gte() { return q },
      lte() { return q },
      lt() { return q },
      order() { return q },
      limit() { return q },
      async maybeSingle(): Promise<{ data: Row | null; error: DbError }> {
        if (table === 'clients') {
          return db.clientError
            ? { data: null, error: db.clientError }
            : { data: { industry: db.clientIndustry }, error: null }
        }
        if (table === 'ad_health_narratives' && columns.includes('payload')) {
          return { data: db.narrative, error: null }
        }
        return { data: null, error: null }
      },
      async upsert(row: Row): Promise<{ error: DbError }> {
        db.upserts.push(row)
        return { error: null }
      },
      update() { return q },
      then<T>(onOk: (v: { data: Row[] | null; error: DbError }) => T, onErr?: (e: unknown) => T): Promise<T> {
        const res = { data: table === 'ad_daily_insights' ? db.insights : null, error: null }
        return Promise.resolve(res).then(onOk, onErr)
      },
    }
    return q
  }

  return { db, sendMock, query }
})

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: (t: string) => h.query(t) } }))
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: h.sendMock }
  },
}))

import { evaluateClientAdHealth, type NarrativePayload } from '../evaluate'
import { sendAdHealthDigest } from '../digest'

/** Flat CTR, cost per result 10 → 16 (+60%): a cost_per_result alert → review_offer. */
function costBlowupRows(): Row[] {
  const d = (i: number) => `2026-07-${String(i).padStart(2, '0')}`
  return Array.from({ length: 21 }, (_, i) => ({
    entity_id: 'camp-1',
    entity_name: 'Campaign 1',
    insight_date: d(i + 1),
    ctr: 0.03,
    cost_per_result: i < 14 ? 10 : 16,
    results: 1,
    spend: 80,
    impressions: 5000,
    frequency_7d: null,
  }))
}

beforeEach(() => {
  h.db.insights = costBlowupRows()
  h.db.clientIndustry = null
  h.db.clientError = null
  h.db.narrative = null
  h.db.upserts = []
  h.sendMock.mockReset()
  h.sendMock.mockResolvedValue({ error: null })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('evaluateClientAdHealth → stored narrative uses the client industry words', () => {
  const run = async () => {
    const r = await evaluateClientAdHealth('client-x', '2026-07-21')
    expect(r.success).toBe(true)
    return h.db.upserts[0].payload as NarrativePayload
  }

  it('industry=travel → verdict and prescription say 咨询, not 结果', async () => {
    h.db.clientIndustry = 'travel'
    const payload = await run()
    const c = payload.campaigns[0]
    expect(c.verdict).toBe('alert')
    expect(c.headline).toContain('每个咨询成本')
    expect(c.prescription?.why).toContain('每个咨询变贵了')
    expect(JSON.stringify(payload)).not.toContain('每个结果')
  })

  it('industry read fails → warns with clientId, still writes neutral words', async () => {
    h.db.clientError = { message: 'boom' }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const payload = await run()
    expect(payload.campaigns[0].headline).toContain('每个结果成本')
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('读客户行业失败'),
      expect.objectContaining({ clientId: 'client-x', error: 'boom' }),
    )
  })
})

describe('sendAdHealthDigest → sent email uses the client industry words', () => {
  const alertNarrative = {
    payload: {
      overall_verdict: 'alert',
      headline: '1 条广告该动手了',
      evaluated: 1,
      generated_for: '2026-07-20',
      campaigns: [
        { campaign_name: 'A', verdict: 'alert', headline: 'h', latest_spend_7d: 100, latest_results_7d: 8 },
      ],
    },
    email_status: null,
  }
  const sentHtml = (): string => (h.sendMock.mock.calls[0][0] as { html: string }).html

  it('industry=travel → body says 咨询, not 结果', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-key')
    h.db.narrative = alertNarrative
    h.db.clientIndustry = 'travel'
    const r = await sendAdHealthDigest('client-x', 'X', '2026-07-20')
    expect(r.sent).toBe(true)
    expect(sentHtml()).toContain('咨询 8')
    expect(sentHtml()).toContain('每个咨询 $12.5')
    expect(sentHtml()).not.toContain('每个结果')
  })

  it('industry read fails → warns with clientId, still sends with neutral words', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-key')
    h.db.narrative = alertNarrative
    h.db.clientError = { message: 'boom' }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await sendAdHealthDigest('client-x', 'X', '2026-07-20')
    expect(r.sent).toBe(true)
    expect(sentHtml()).toContain('每个结果 $12.5')
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('读客户行业失败'),
      expect.objectContaining({ clientId: 'client-x', error: 'boom' }),
    )
  })
})
