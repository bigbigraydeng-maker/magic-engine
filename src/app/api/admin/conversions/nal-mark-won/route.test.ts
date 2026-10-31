import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/require-admin', () => ({ guardAdmin: vi.fn(async () => null) }))
vi.mock('@/lib/conversions/route-guard', () => ({
  guardConversionRoute: vi.fn(async () => ({
    ok: true,
    ctx: { actor: 'fde@example.com', ip: null, ua: null, requestId: 'req-1' },
  })),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/conversions/crm-deal-supabase', () => ({ supabaseDealIo: vi.fn(() => ({})) }))
vi.mock('@/lib/conversions/crm-deal-record', () => ({ recordStageDeal: vi.fn() }))
vi.mock('@/lib/crm/advance-contact-stage', () => ({
  advanceContactStage: vi.fn(async () => ({ ok: true, stage: 'won', changed: true })),
}))

import { guardConversionRoute } from '@/lib/conversions/route-guard'
import { recordStageDeal } from '@/lib/conversions/crm-deal-record'
import { advanceContactStage } from '@/lib/crm/advance-contact-stage'
import { POST } from './route'

const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CONTACT = '11111111-1111-4111-8111-111111111111'

function result(over: Record<string, unknown> = {}) {
  return {
    attempted: true,
    recorded: false,
    alreadyRecorded: false,
    outcomeId: null,
    reason: null,
    message: '',
    advanceStage: false,
    doNotContact: false,
    ...over,
  }
}

async function post(body: unknown) {
  const res = await POST(new Request('http://localhost/api/admin/conversions/nal-mark-won', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  vi.mocked(recordStageDeal).mockReset()
  vi.mocked(advanceContactStage).mockClear()
  vi.mocked(guardConversionRoute).mockClear()
})

describe('POST stage deal', () => {
  it('source has no client uuid', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/admin/conversions/nal-mark-won/route.ts'), 'utf8')
    expect(src).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  })

  it('missing clientId is 400 and does not record or advance', async () => {
    const { status } = await post({ contactId: CONTACT, stageKey: 'won' })
    expect(status).toBe(400)
    expect(recordStageDeal).not.toHaveBeenCalled()
    expect(advanceContactStage).not.toHaveBeenCalled()
  })

  it('negative amount is 400 and does not record or advance', async () => {
    const { status } = await post({ clientId: CLIENT, contactId: CONTACT, stageKey: 'won', amountMajor: -5, currency: 'NZD' })
    expect(status).toBe(400)
    expect(recordStageDeal).not.toHaveBeenCalled()
    expect(advanceContactStage).not.toHaveBeenCalled()
  })

  it('guards with the client id from the body', async () => {
    vi.mocked(recordStageDeal).mockResolvedValue(result({ reason: 'stage_mismatch', attempted: false }))
    await post({ clientId: CLIENT, contactId: CONTACT, stageKey: 'won' })
    expect(guardConversionRoute).toHaveBeenCalledWith(expect.any(Request), CLIENT)
  })

  it('no match key does not advance', async () => {
    vi.mocked(recordStageDeal).mockResolvedValue(result({ reason: 'no_match_key', message: '没有匹配键' }))
    const { status } = await post({ clientId: CLIENT, contactId: CONTACT, stageKey: 'won' })
    expect(status).toBe(400)
    expect(advanceContactStage).not.toHaveBeenCalled()
  })

  it('insert error does not advance', async () => {
    vi.mocked(recordStageDeal).mockResolvedValue(result({ reason: 'record_failed', message: '成交记录没有写成。' }))
    const { status, body } = await post({ clientId: CLIENT, contactId: CONTACT, stageKey: 'won' })
    expect(status).toBe(500)
    expect(body.error).not.toMatch(/select|insert|sql/i)
    expect(advanceContactStage).not.toHaveBeenCalled()
  })

  it('the wrong stage does not advance', async () => {
    vi.mocked(recordStageDeal).mockResolvedValue(result({ attempted: false, reason: 'stage_mismatch' }))
    const { status } = await post({ clientId: CLIENT, contactId: CONTACT, stageKey: 'quoted' })
    expect(status).toBe(400)
    expect(advanceContactStage).not.toHaveBeenCalled()
  })

  it('a non-live client advances without an outcome id', async () => {
    vi.mocked(recordStageDeal).mockResolvedValue(result({ reason: 'not_live', advanceStage: true, message: '还没开' }))
    const { status, body } = await post({ clientId: CLIENT, contactId: CONTACT, stageKey: 'won' })
    expect(status).toBe(200)
    expect(body.outcomeId).toBeNull()
    expect(advanceContactStage).toHaveBeenCalledTimes(1)
  })

  it('a cross-source skip advances and does not claim a new outcome', async () => {
    vi.mocked(recordStageDeal).mockResolvedValue(result({ reason: 'recent_other_source', advanceStage: true, message: '近 30 天' }))
    const { status, body } = await post({ clientId: CLIENT, contactId: CONTACT, stageKey: 'won' })
    expect(status).toBe(200)
    expect(body.outcomeId).toBeNull()
    expect(advanceContactStage).toHaveBeenCalledTimes(1)
  })

  it('a stored purchase advances afterwards', async () => {
    vi.mocked(recordStageDeal).mockResolvedValue(result({
      recorded: true, outcomeId: 'out-1', advanceStage: true, message: '记下了，等审核后再发给广告平台。',
    }))
    const { status, body } = await post({ clientId: CLIENT, contactId: CONTACT, stageKey: 'won' })
    expect(status).toBe(200)
    expect(body.outcomeId).toBe('out-1')
    expect(body.message).toContain('审核')
    expect(advanceContactStage).toHaveBeenCalledTimes(1)
  })
})
