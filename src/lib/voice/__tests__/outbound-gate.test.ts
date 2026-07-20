import { describe, it, expect, beforeEach } from 'vitest'
import { assertOutboundAllowed, isTestNumber } from '../outbound-gate'
import { resetVoiceConfigCache } from '../config'
import { InMemoryVoiceStore } from '../store/memory'
import { VoiceError } from '../domain'
import type { ContactRow } from '../store/types'

const TENANT = 't1'
const TEST_NUM = '+6421999999'
const REAL_NUM = '+6421123456'

function setEnv(outboundEnabled: boolean) {
  process.env.VOICE_TEST_NUMBERS = TEST_NUM
  process.env.OUTBOUND_CALLING_ENABLED = outboundEnabled ? 'true' : 'false'
  process.env.MOCK_EXTERNAL_SERVICES = 'true'
  resetVoiceConfigCache()
}

const contact = (o: Partial<ContactRow> = {}): ContactRow => ({
  id: 'c1', tenant_id: TENANT, phone_e164: REAL_NUM, whatsapp_phone_e164: null, email: null,
  first_name: null, last_name: null, preferred_language: null, consent_status: 'unknown',
  do_not_call: false, me_lead_id: null, metadata: {}, ...o,
})

const withinHours = new Date('2026-07-15T14:00:00Z') // 14h in UTC tz
const base = { tenantId: TENANT, timezone: 'UTC', now: withinHours, quietHours: { startHour: 9, endHour: 20 } }

describe('OutboundGate (魏征 #4 / 板桥 #7)', () => {
  let store: InMemoryVoiceStore
  beforeEach(() => { store = new InMemoryVoiceStore(); setEnv(false) })

  it('test number + outbound disabled → allowed as mock', async () => {
    const r = await assertOutboundAllowed(store, { ...base, toNumber: TEST_NUM })
    expect(r.mode).toBe('mock')
  })

  it('板桥 #7: non-test number with outbound disabled → REJECTED', async () => {
    await expect(assertOutboundAllowed(store, { ...base, toNumber: REAL_NUM })).rejects.toBeInstanceOf(VoiceError)
  })

  // Mutation guard: if the do_not_call check is removed, this test fails.
  it('do_not_call contact → blocked', async () => {
    await expect(
      assertOutboundAllowed(store, { ...base, toNumber: TEST_NUM, contact: contact({ do_not_call: true }) }),
    ).rejects.toMatchObject({ code: 'OUTBOUND_BLOCKED' })
  })

  it('consent withdrawn → blocked', async () => {
    await expect(
      assertOutboundAllowed(store, { ...base, toNumber: TEST_NUM, contact: contact({ consent_status: 'withdrawn' }) }),
    ).rejects.toMatchObject({ code: 'OUTBOUND_BLOCKED' })
  })

  it('suppressed number → blocked', async () => {
    await store.addSuppression(TENANT, TEST_NUM, 'stop')
    await expect(assertOutboundAllowed(store, { ...base, toNumber: TEST_NUM })).rejects.toMatchObject({ code: 'OUTBOUND_BLOCKED' })
  })

  it('quiet hours → blocked (real dialling)', async () => {
    setEnv(true)
    const night = new Date('2026-07-15T03:00:00Z') // 3h local
    await expect(assertOutboundAllowed(store, { ...base, now: night, toNumber: TEST_NUM })).rejects.toMatchObject({ code: 'OUTBOUND_BLOCKED' })
  })

  it('frequency cap → blocked after 3 calls in 24h (real dialling)', async () => {
    setEnv(true)
    for (let i = 0; i < 3; i++) {
      await store.createCall({
        tenant_id: TENANT, agent_id: 'a1', contact_id: null, lead_id: null, channel: 'sip',
        direction: 'outbound', provider: 'mock', is_simulated: true, provider_call_id: null,
        openai_call_id: null, from_number: null, to_number: TEST_NUM, status: 'completed',
        started_at: null, answered_at: null, ended_at: null, duration_seconds: null, language_detected: null,
        recording_url: null, transcript_status: 'final', summary_status: 'done', summary: null, outcome: null,
        disposition: null, structured_outcome: {}, usage: {}, cost_estimate: {}, error_code: null, error_message: null,
      })
    }
    await expect(assertOutboundAllowed(store, { ...base, toNumber: TEST_NUM })).rejects.toMatchObject({ code: 'OUTBOUND_BLOCKED' })
  })

  it('invalid E.164 → blocked', async () => {
    await expect(assertOutboundAllowed(store, { ...base, toNumber: '021abc' })).rejects.toMatchObject({ code: 'OUTBOUND_BLOCKED' })
  })

  it('outbound enabled + test number → real mode', async () => {
    setEnv(true)
    const r = await assertOutboundAllowed(store, { ...base, toNumber: TEST_NUM })
    expect(r.mode).toBe('real')
    expect(isTestNumber(TEST_NUM)).toBe(true)
  })
})
