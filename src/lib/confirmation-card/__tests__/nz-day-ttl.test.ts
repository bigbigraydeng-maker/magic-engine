import { describe, expect, it } from 'vitest'
import { createCapabilities } from '@/lib/capabilities'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { CONFIRMATION_ACTION_KEY } from '@/lib/kernel/registry-confirmation'
import { CLIENT_A, makeFixture } from '@/lib/kernel/__tests__/fixtures'
import { endOfNzDayMs } from '@/lib/ads-strategy/promo-window'
import type { CardClicker } from '../actor'
import type { CardFacts } from '../facts'
import { decideConfirmationCard } from '../decide'
import { issueConfirmationCard } from '../issue'
import { listConfirmationCards } from '../list'
import { isExpired } from '../view'

const KEY = CONFIRMATION_ACTION_KEY
const OPC: CardClicker = { kind: 'opc', email: 'opc@example.com' }
const FACTS: CardFacts = {
  subjectKey: 'daily-pause',
  what: '记下要不要暂停这个广告系列',
  account: '测试广告账户',
  amount: '不改预算',
  date: '确认之后才改',
  scope: '只暂停这一个广告系列',
  hardChecks: [{ label: '确认后才改', state: 'green', reason: '这一步只出卡' }],
}

function fixture(startAt: string) {
  const f = makeFixture({
    registry: ACTION_REGISTRY,
    startAt,
    capabilities: (sb) => ({ [KEY]: createCapabilities(sb)[KEY] }),
  })
  return f
}

describe('NZ day expiry', () => {
  it('stays valid through a daylight-saving change and ends at 23:59:59 that NZ day', () => {
    const springIssued = '2026-09-26T13:30:00.000Z'
    const springEnd = endOfNzDayMs('2026-09-27')
    expect(isExpired(springIssued, new Date('2026-09-26T23:00:00.000Z'), 'nz_day')).toBe(false)
    expect(isExpired(springIssued, new Date(springEnd), 'nz_day')).toBe(false)
    expect(isExpired(springIssued, new Date(springEnd + 1), 'nz_day')).toBe(true)

    const autumnIssued = '2027-04-03T18:00:00.000Z'
    const autumnEnd = endOfNzDayMs('2027-04-04')
    expect(isExpired(autumnIssued, new Date('2027-04-04T10:00:00.000Z'), 'nz_day')).toBe(false)
    expect(isExpired(autumnIssued, new Date(autumnEnd), 'nz_day')).toBe(false)
    expect(isExpired(autumnIssued, new Date(autumnEnd + 1000), 'nz_day')).toBe(true)
  })

  it('keeps a daily card until NZ midnight and expires a manual card after 30 minutes', async () => {
    const issued = new Date('2026-11-08T17:00:00.000Z')
    const later = new Date(issued.getTime() + 31 * 60 * 1000)
    const sameAfternoon = new Date('2026-11-09T05:00:00.000Z')
    const afterMidnight = new Date(endOfNzDayMs('2026-11-09') + 1000)

    const daily = fixture(issued.toISOString())
    const card = await issueConfirmationCard(daily.kernel, {
      clientId: CLIENT_A, clicker: OPC, facts: FACTS, now: issued, lifetime: 'nz_day',
    })
    daily.clock.now = later
    const midday = await listConfirmationCards(daily.kernel, CLIENT_A, OPC, later)
    expect(midday.find((item) => item.runId === card.runId)?.status).toBe('waiting')
    daily.clock.now = sameAfternoon
    const afternoon = await listConfirmationCards(daily.kernel, CLIENT_A, OPC, sameAfternoon)
    expect(afternoon.find((item) => item.runId === card.runId)?.status).toBe('waiting')
    const expired = await decideConfirmationCard(daily.kernel, {
      clientId: CLIENT_A,
      runId: card.runId,
      clicker: OPC,
      resolution: 'confirm',
      expectedDecisionId: card.expectedDecisionId,
      fingerprint: card.fingerprint,
      now: afterMidnight,
    })
    expect(expired.status).toBe('expired')
    expect(expired.statusLine).toContain('23:59')

    const manual = fixture(issued.toISOString())
    const urgent = await issueConfirmationCard(manual.kernel, {
      clientId: CLIENT_A, clicker: OPC, facts: { ...FACTS, subjectKey: 'manual-pause' }, now: issued, lifetime: 'urgent_30m',
    })
    const still = await listConfirmationCards(manual.kernel, CLIENT_A, OPC, new Date(issued.getTime() + 29 * 60 * 1000))
    expect(still.find((item) => item.runId === urgent.runId)?.status).toBe('waiting')
    const gone = await listConfirmationCards(manual.kernel, CLIENT_A, OPC, later)
    expect(gone.find((item) => item.runId === urgent.runId)?.status).toBe('expired')
    expect(gone.find((item) => item.runId === urgent.runId)?.statusLine).toContain('30 分钟')
  })
})
