import { describe, expect, it, vi } from 'vitest'
import { checkCatalogueEligibility, type EligibilityContact, type EligibilityData, type EligibilityStage } from '../eligibility'

// Design §5 rows 1-6: each test fails if its check is removed.

const NOW = new Date('2026-11-09T00:00:00Z')
const STAGES: EligibilityStage[] = [
  { stageKey: 'new', marketingAction: 'nurture', isTerminal: false },
  { stageKey: 'later', marketingAction: 'defer', isTerminal: false },
  { stageKey: 'stopped', marketingAction: 'suppress', isTerminal: false },
  { stageKey: 'deposit', marketingAction: 'postsale', isTerminal: false },
  { stageKey: 'done', marketingAction: 'won', isTerminal: false },
  { stageKey: 'lost', marketingAction: 'nurture', isTerminal: true },
  { stageKey: 'weird', marketingAction: 'teleport', isTerminal: false },
]

function data(contact: Partial<EligibilityContact> | null, over: Partial<EligibilityData> = {}): EligibilityData {
  return {
    loadContact: vi.fn(async () => (contact === null ? null : { doNotContact: false, stage: 'new', snoozeUntil: null, ...contact })),
    loadStages: vi.fn(async () => STAGES),
    ...over,
  }
}

const check = (d: EligibilityData) => checkCatalogueEligibility({ clientId: 'c', contactId: 'k', now: NOW }, d)

describe('checkCatalogueEligibility', () => {
  it('a nurtured guest, and a guest with no stage yet, may be sent the catalogue', async () => {
    expect(await check(data({}))).toEqual({ ok: true })
    expect(await check(data({ stage: null }))).toEqual({ ok: true })
  })

  it('do not contact', async () => {
    expect(await check(data({ doNotContact: true }))).toMatchObject({ ok: false, reason: 'do_not_contact' })
  })

  it.each(['stopped', 'deposit', 'done', 'lost'])('a stage with a conclusion (%s)', async (stage) => {
    expect(await check(data({ stage }))).toMatchObject({ ok: false, reason: 'stage_suppressed' })
  })

  it('a deferred stage', async () => {
    expect(await check(data({ stage: 'later' }))).toMatchObject({ ok: false, reason: 'stage_deferred' })
  })

  it('a stage the config does not have, or an action this code does not know, is never "fine"', async () => {
    expect(await check(data({ stage: 'gone' }))).toMatchObject({ ok: false, reason: 'stage_unknown' })
    expect(await check(data({ stage: 'weird' }))).toMatchObject({ ok: false, reason: 'stage_unknown' })
  })

  it('snoozed until tomorrow; a snooze in the past no longer holds; an unreadable date holds', async () => {
    expect(await check(data({ snoozeUntil: '2026-11-10T00:00:00Z' }))).toMatchObject({ ok: false, reason: 'snoozed' })
    expect(await check(data({ snoozeUntil: '2026-11-08T00:00:00Z' }))).toEqual({ ok: true })
    expect(await check(data({ snoozeUntil: 'soon' }))).toMatchObject({ ok: false, reason: 'snoozed' })
  })

  it('stage config that cannot be read is a refusal, never a pass', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const broken = data({}, { loadStages: vi.fn(async () => Promise.reject(new Error('db down'))) })
    expect(await check(broken)).toMatchObject({ ok: false, reason: 'eligibility_unreadable' })
    const noContact = data({}, { loadContact: vi.fn(async () => Promise.reject(new Error('db down'))) })
    expect(await check(noContact)).toMatchObject({ ok: false, reason: 'eligibility_unreadable' })
  })

  it('no such guest', async () => {
    expect(await check(data(null))).toMatchObject({ ok: false, reason: 'not_found' })
  })
})
