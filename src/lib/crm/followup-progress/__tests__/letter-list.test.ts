import { describe, expect, it, vi } from 'vitest'
import { activityFacts, checkLetterRelease, DEFAULT_LETTER_RULES, letterRequestId, letterStatus, loadLetterList, RELEASE_REFUSAL, type GuestRows, type LetterFacts, type LetterListDeps } from '../letter-list'
import { emptyCounts, type GroupVerdict } from '../groups'
import type { FollowupProgressDetail } from '../load'
import type { ContactRowLike, TouchpointRowLike } from '@/lib/crm/contact-model'
import { buildTouchpointLike } from '@/lib/crm/contact-model'
import type { ComposePreview } from '@/lib/microsoft/mail-send-new'

const NOW = new Date('2026-11-28T02:00:00Z') // 15:00 on 28 Nov in Auckland
const TZ = 'Pacific/Auckland'
const R = DEFAULT_LETTER_RULES
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString()
const ahead = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString()

describe('letterStatus — who the AI may draft for', () => {
  const base: LetterFacts = { segment: 'stale_conversation', lastActivityAt: ago(40), callbackAt: null, declined: false, sendTimes: [], lastGuestSignalAt: ago(60), bulkLast7Days: 0 }
  const st = (over: Partial<LetterFacts>) => letterStatus({ ...base, ...over }, NOW)

  it('a quiet guest the staff list would hand to a letter: due', () => {
    expect(st({})).toBe('due')
    expect(st({ segment: 'retry_channel' })).toBe('due')
    expect(st({ segment: 'handoff_sop' })).toBe('due')
  })

  it('anyone the staff list gives to staff today is staff\'s, whatever else is true', () => {
    for (const segment of ['replied', 'callback_due', 'new_untouched', 'reading_site', 'clicked_link'] as const) expect(st({ segment }), segment).toBe('staff_today')
  })

  it('anyone that list has parked or excluded is nobody\'s to write to', () => {
    for (const segment of ['nurture_future', 'excluded', 'not_enquiry_suspect'] as const) expect(st({ segment }), segment).toBe('parked')
  })

  it('said no or "not now" and has not come back: the AI does not write', () => {
    expect(st({ declined: true })).toBe('declined')
  })

  it('a callback set for later, or one from the last two weeks, keeps the AI out; an old one does not', () => {
    expect(st({ callbackAt: ahead(20) })).toBe('callback_set')
    expect(st({ callbackAt: ago(3) })).toBe('callback_set')
    expect(st({ callbackAt: ago(R.quietDays + 1) })).toBe('due')
  })

  it('anything human in the quiet days, on either side: the AI stays out', () => {
    expect(st({ lastActivityAt: ago(R.quietDays - 1) })).toBe('recent_activity')
    expect(st({ lastActivityAt: ago(R.quietDays) })).toBe('due')
  })

  it('one letter per guest per 30 days from the sales mailbox, whoever sent it', () => {
    expect(st({ sendTimes: [ago(29)] })).toBe('already_written')
    expect(st({ sendTimes: [ago(31)] })).toBe('due')
  })

  it('stops after two letters with no answer; an answer or a new form starts the count again', () => {
    expect(st({ sendTimes: [ago(80), ago(40)], lastGuestSignalAt: ago(100) })).toBe('no_reply_stop')
    expect(st({ sendTimes: [ago(80), ago(40)], lastGuestSignalAt: ago(60) })).toBe('due')
    expect(st({ sendTimes: [ago(80), ago(40)], lastGuestSignalAt: null })).toBe('no_reply_stop')
  })

  it('bulk mails count toward the weekly limit', () => {
    expect(st({ bulkLast7Days: 1 })).toBe('due')
    expect(st({ bulkLast7Days: 2 })).toBe('weekly_limit')
  })

  it('a date that cannot be read keeps the AI away rather than letting it in', () => {
    expect(st({ lastActivityAt: 'not a date' })).toBe('recent_activity')
    expect(st({ callbackAt: 'not a date' })).toBe('callback_set')
    expect(st({ sendTimes: ['not a date'] })).toBe('already_written')
  })
})

const touch = (over: Partial<TouchpointRowLike>): TouchpointRowLike => ({ contact_id: 'g', channel: 'email', direction: 'outbound', occurred_at: ago(40), source: 'microsoft_mail', raw: null, metadata: null, ...over })
const facts = (rows: TouchpointRowLike[]) => activityFacts(rows.map(buildTouchpointLike))

describe('activityFacts — what counts as "something human happened"', () => {
  it('a call nobody answered, a Messenger message either way, a staff note and a guest reply all count', () => {
    expect(facts([touch({ channel: 'phone', source: 'twilio', occurred_at: ago(2), metadata: { answered: false, outcome: 'no_answer' } })]).lastActivityAt).toBe(ago(2))
    expect(facts([touch({ channel: 'messenger', source: 'messenger', occurred_at: ago(3) })]).lastActivityAt).toBe(ago(3))
    expect(facts([touch({ channel: 'messenger', source: 'messenger', direction: 'inbound', occurred_at: ago(1) })]).lastActivityAt).toBe(ago(1))
    expect(facts([touch({ channel: 'phone', source: 'me_manual', occurred_at: ago(4) })]).lastActivityAt).toBe(ago(4))
    expect(facts([touch({ direction: 'inbound', occurred_at: ago(5) })]).lastActivityAt).toBe(ago(5))
  })

  it('a bulk mail, a machine mail and the guest opening a mail are not activity', () => {
    expect(facts([
      touch({ source: 'mailchimp', occurred_at: ago(1) }),
      touch({ metadata: { automated: true }, occurred_at: ago(1) }),
      touch({ source: 'mailchimp', direction: 'inbound', occurred_at: ago(1), metadata: { email_opened: true } }),
      touch({ occurred_at: ago(50) }),
    ]).lastActivityAt).toBe(ago(50))
  })

  it('the callback is the one on the latest record that set one (a re-booked callback wins)', () => {
    expect(facts([
      touch({ channel: 'phone', source: 'me_manual', occurred_at: ago(30), metadata: { callback_at: ago(20) } }),
      touch({ channel: 'phone', source: 'me_manual', occurred_at: ago(10), metadata: { callback_at: ahead(5) } }),
    ]).callbackAt).toBe(ahead(5))
  })

  it('"not interested" stands until the guest comes back', () => {
    const no = touch({ channel: 'phone', source: 'me_manual', occurred_at: ago(30), metadata: { outcome: 'not_interested' } })
    expect(facts([no]).declined).toBe(true)
    expect(facts([no, touch({ direction: 'inbound', occurred_at: ago(5) })]).declined).toBe(false)
    expect(facts([touch({ direction: 'inbound', occurred_at: ago(50) }), no]).declined).toBe(true)
  })
})

describe('letterRequestId', () => {
  it('is the same while nothing human happens, and new the moment something does', () => {
    expect(letterRequestId('g1', ago(40))).toBe(letterRequestId('g1', ago(40)))
    expect(letterRequestId('g1', ago(40))).not.toBe(letterRequestId('g1', ago(0)))
    expect(letterRequestId('g1', ago(40))).not.toBe(letterRequestId('g2', ago(40)))
    expect(letterRequestId('g1', null)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

// ── the loader, with a small world ─────────────────────────────────────────────────────────────────────────────────

type G = { id: string; verdict?: GroupVerdict; engaged?: string; bulk?: number; touches?: TouchpointRowLike[]; sends?: string[]; snooze?: string }
const warm: GroupVerdict = { inScope: true, group: 'warm' }
/** A guest we spoke with 40 days ago and nothing since: the staff list calls this a conversation that went quiet. */
const quiet = (id: string): TouchpointRowLike[] => [
  touch({ contact_id: id, channel: 'meta_lead_form', source: 'meta_lead_form', direction: 'inbound', occurred_at: ago(60) }),
  touch({ contact_id: id, channel: 'phone', source: 'me_manual', occurred_at: ago(40), metadata: { outcome: 'spoke' } }),
]
const ok = (recent = 0): ComposePreview => ({ canCompose: true, recipient: 'x@example.com', mailbox: 'sales@example.com', sentToContactLast7Days: recent })

function world(guests: G[], over: Partial<LetterListDeps> = {}): LetterListDeps {
  const detail = (only: string | null): FollowupProgressDetail => {
    const verdicts = new Map<string, GroupVerdict>()
    const dates: FollowupProgressDetail['dates'] = new Map()
    for (const g of guests) {
      if (only !== null && g.id !== only) continue
      verdicts.set(g.id, g.verdict ?? warm)
      dates.set(g.id, { lastEnquiryAt: ago(60), lastGuestMessageAt: null, lastStaffAt: ago(40), lastEngagedAt: g.engaged ?? ago(3), bulkLast7Days: g.bulk ?? 0 })
    }
    return { clientId: 'c', at: NOW.toISOString(), counts: emptyCounts(), week: { guestsContactedByStaff: 0, guestsWhoReplied: 0, newEnquiries: 0, movedToQualified: 0, newBookings: 0, takenByAi: 0 }, verdicts, dates }
  }
  const rows = (ids: readonly string[]): GuestRows => ({
    contacts: guests.filter((g) => ids.includes(g.id)).map((g): ContactRowLike => ({ id: g.id, display_name: `Guest ${g.id}`, primary_phone: '+64210000000', primary_email: `${g.id}@example.com`, do_not_contact: false, snooze_until: g.snooze ?? null, stage: 'contacted' })),
    touches: guests.filter((g) => ids.includes(g.id)).flatMap((g) => g.touches ?? quiet(g.id)),
    stageMeta: new Map([['contacted', { label: '已联系', suppressed: false }]]),
    siteReading: new Map(),
  })
  return {
    timeZone: TZ,
    weeklyMax: null,
    loadProgress: async (only) => detail(only),
    loadGuestRows: async (ids) => rows(ids),
    loadSendTimes: async (ids) => new Map(guests.filter((g) => ids.includes(g.id) && g.sends).map((g) => [g.id, g.sends ?? []])),
    countSentSince: async () => 0,
    loadNames: async (ids) => new Map(ids.map((id) => [id, `Guest ${id}`])),
    compose: vi.fn(async () => ok()),
    ...over,
  }
}

describe('loadLetterList', () => {
  it('only the "still opening our emails" group is ever listed', async () => {
    const list = await loadLetterList(world([{ id: 'w' }, { id: 'a', verdict: { inScope: true, group: 'awaiting_reply' } }, { id: 'q', verdict: { inScope: true, group: 'qualified' } }, { id: 'n', verdict: { inScope: true, group: 'new_lead' } }, { id: 'b', verdict: { inScope: false, why: 'booked' } }]), NOW)
    expect(list.rows.map((r) => r.contactId)).toEqual(['w'])
  })

  it('the guest who opened a mail most recently comes first', async () => {
    const list = await loadLetterList(world([{ id: 'old', engaged: ago(20) }, { id: 'new', engaged: ago(1) }, { id: 'mid', engaged: ago(5) }]), NOW)
    expect(list.rows.map((r) => r.contactId)).toEqual(['new', 'mid', 'old'])
  })

  it('the collisions the review found: each of these guests is left to staff and never mail-checked or drafted', async () => {
    const compose = vi.fn(async () => ok())
    const list = await loadLetterList(world([
      { id: 'due' },
      // a staff member tried to ring yesterday, nobody answered
      { id: 'tried', touches: [...quiet('tried'), touch({ contact_id: 'tried', channel: 'phone', source: 'twilio', occurred_at: ago(1), metadata: { answered: false, outcome: 'no_answer' } })] },
      // staff and the guest are talking on Messenger
      { id: 'chat', touches: [...quiet('chat'), touch({ contact_id: 'chat', channel: 'messenger', source: 'messenger', occurred_at: ago(2) })] },
      // a callback booked for next week, on a note older than the quiet days
      { id: 'cb', touches: [touch({ contact_id: 'cb', channel: 'meta_lead_form', source: 'meta_lead_form', direction: 'inbound', occurred_at: ago(60) }), touch({ contact_id: 'cb', channel: 'phone', source: 'me_manual', occurred_at: ago(20), metadata: { outcome: 'callback_set', callback_at: ahead(7) } })] },
      // the note says the guest is not interested; the stage was never changed
      { id: 'no', touches: [...quiet('no'), touch({ contact_id: 'no', channel: 'phone', source: 'me_manual', occurred_at: ago(30), metadata: { outcome: 'not_interested' } })] },
      // the guest wrote back yesterday
      { id: 'back', touches: [...quiet('back'), touch({ contact_id: 'back', direction: 'inbound', occurred_at: ago(1) })] },
      // snoozed by staff until next month
      { id: 'zz', snooze: ahead(20) },
      { id: 'written', sends: [ago(10)] },
      { id: 'bulk', bulk: 3 },
    ], { compose }), NOW)
    expect(list.rows.map((r) => r.contactId)).toEqual(['due'])
    expect(compose).toHaveBeenCalledTimes(1)
    const left = list.counts.staff_today + list.counts.parked + list.counts.callback_set + list.counts.declined + list.counts.recent_activity + list.counts.already_written + list.counts.weekly_limit
    expect(left).toBe(8)
    expect(list.counts).toMatchObject({ due: 1, already_written: 1, weekly_limit: 1 })
  })

  it('at most the daily number of letters; letters already sent today use up the room', async () => {
    const many: G[] = []
    for (let i = 0; i < 25; i++) many.push({ id: `g${String(i).padStart(2, '0')}`, engaged: ago(i + 1) })
    const none = await loadLetterList(world(many), NOW)
    expect(none.rows).toHaveLength(R.dailyMax)
    expect(none.counts).toMatchObject({ due: 25, sentToday: 0, room: R.dailyMax })
    const some = await loadLetterList(world(many, { countSentSince: async () => 4 }), NOW)
    expect(some.counts).toMatchObject({ sentToday: 4, room: R.dailyMax - 4 })
    expect(some.rows).toHaveLength(R.dailyMax - 4)
    const full = await loadLetterList(world(many, { countSentSince: async () => 50 }), NOW)
    expect(full.counts.room).toBe(0)
    expect(full.rows).toEqual([])
  })

  it('"today" for the daily room starts at the client\'s own midnight', async () => {
    const countSentSince = vi.fn(async () => 0)
    await loadLetterList(world([{ id: 'a' }], { countSentSince }), NOW)
    // 28 Nov 00:00 in Auckland (UTC+13) is 27 Nov 11:00 UTC.
    expect(countSentSince).toHaveBeenCalledWith('2026-11-27T11:00:00.000Z')
  })

  it('the weekly limit is the client\'s own number when it has one, and adds bulk mails the mailbox cannot see', async () => {
    const compose = vi.fn(async (id: string) => ok(id === 'a' ? 1 : 0))
    const list = await loadLetterList(world([{ id: 'a', bulk: 1 }, { id: 'b', bulk: 1 }], { compose }), NOW)
    const byId = new Map(list.rows.map((r) => [r.contactId, r]))
    expect(byId.get('a')).toMatchObject({ status: 'cannot_send', sentLast7Days: 2 })
    expect(byId.get('a')?.message).toContain('含群发')
    expect(byId.get('b')).toMatchObject({ status: 'ready', sentLast7Days: 1, recipient: 'x@example.com' })
    const loose = await loadLetterList(world([{ id: 'a', bulk: 1 }], { compose, weeklyMax: 3 }), NOW)
    expect(loose.rules.weeklyMax).toBe(3)
    expect(loose.rows[0].status).toBe('ready')
  })

  it('a guest the mailbox cannot write to is shown with the reason, not dropped', async () => {
    const list = await loadLetterList(world([{ id: 'a' }], { compose: async () => ({ canCompose: false, message: '这位客人没有邮箱' }) as ComposePreview }), NOW)
    expect(list.rows[0]).toMatchObject({ status: 'cannot_send', message: '这位客人没有邮箱', recipient: null })
  })

  it('a read error is an error, never a short list', async () => {
    await expect(loadLetterList(world([{ id: 'a' }], { loadSendTimes: async () => { throw new Error('log unreadable') } }), NOW)).rejects.toThrow('log unreadable')
    await expect(loadLetterList(world([{ id: 'a' }], { loadGuestRows: async () => { throw new Error('rows unreadable') } }), NOW)).rejects.toThrow('rows unreadable')
    await expect(loadLetterList(world([{ id: 'a' }], { countSentSince: async () => { throw new Error('receipts unreadable') } }), NOW)).rejects.toThrow('receipts unreadable')
    await expect(loadLetterList(world([{ id: 'a' }], { compose: async () => { throw new Error('mailbox down') } }), NOW)).rejects.toThrow('mailbox down')
  })
})

describe('checkLetterRelease — the judgement again, at the moment of release', () => {
  const idOf = async (deps: LetterListDeps) => (await loadLetterList(deps, NOW)).rows[0].requestId

  it('nothing changed since the list: the letter may go', async () => {
    const deps = world([{ id: 'a' }])
    expect(await checkLetterRelease(deps, { contactId: 'a', requestId: await idOf(deps) }, NOW)).toEqual({ ok: true })
  })

  it('reads one guest, not the whole book', async () => {
    const deps = world([{ id: 'a' }, { id: 'b' }])
    const loadProgress = vi.fn(deps.loadProgress)
    const id = await idOf(deps)
    await checkLetterRelease({ ...deps, loadProgress }, { contactId: 'a', requestId: id }, NOW)
    expect(loadProgress).toHaveBeenCalledWith('a')
  })

  it('a staff member rang an hour after the list was opened (nobody answered): the letter is stopped', async () => {
    const before = world([{ id: 'a' }])
    const id = await idOf(before)
    const after = world([{ id: 'a', touches: [...quiet('a'), touch({ contact_id: 'a', channel: 'phone', source: 'twilio', occurred_at: new Date(NOW.getTime() - 60_000).toISOString(), metadata: { answered: false, outcome: 'no_answer' } })] }])
    expect(await checkLetterRelease(after, { contactId: 'a', requestId: id }, NOW)).toMatchObject({ ok: false, reason: 'recent_activity', message: RELEASE_REFUSAL.recent_activity })
  })

  it('the guest replied since: stopped, and it says the guest is no longer in the group', async () => {
    const before = world([{ id: 'a' }])
    const id = await idOf(before)
    const after = world([{ id: 'a', verdict: { inScope: true, group: 'awaiting_reply' } }])
    expect(await checkLetterRelease(after, { contactId: 'a', requestId: id }, NOW)).toMatchObject({ ok: false, reason: 'not_in_group' })
  })

  it('a request id from another round is refused even when the guest is due again', async () => {
    const deps = world([{ id: 'a' }])
    expect(await checkLetterRelease(deps, { contactId: 'a', requestId: letterRequestId('a', ago(90)) }, NOW)).toMatchObject({ ok: false, reason: 'changed' })
  })

  it('a colleague released the same letter a moment ago: refused as already written', async () => {
    const before = world([{ id: 'a' }])
    const id = await idOf(before)
    const after = world([{ id: 'a', sends: [new Date(NOW.getTime() - 30_000).toISOString()] }])
    expect(await checkLetterRelease(after, { contactId: 'a', requestId: id }, NOW)).toMatchObject({ ok: false, reason: 'already_written' })
  })

  it('the day\'s cap was reached while the page was open: refused', async () => {
    const deps = world([{ id: 'a' }])
    const id = await idOf(deps)
    expect(await checkLetterRelease({ ...deps, countSentSince: async () => R.dailyMax }, { contactId: 'a', requestId: id }, NOW)).toMatchObject({ ok: false, reason: 'daily_cap' })
  })

  it('the mailbox or the weekly count now says no: refused with that reason', async () => {
    const deps = world([{ id: 'a', bulk: 1 }])
    const id = await idOf(deps)
    const r = await checkLetterRelease({ ...deps, compose: async () => ok(1) }, { contactId: 'a', requestId: id }, NOW)
    expect(r).toMatchObject({ ok: false, reason: 'mail_check' })
  })

  it('a read error stops the release', async () => {
    const deps = world([{ id: 'a' }])
    await expect(checkLetterRelease({ ...deps, loadGuestRows: async () => { throw new Error('rows unreadable') } }, { contactId: 'a', requestId: 'x' }, NOW)).rejects.toThrow('rows unreadable')
  })
})
