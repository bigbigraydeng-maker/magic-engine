// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildPriorityView } from '../contact-list-view'
import type { ContactRowLike, StageMetaLike, TouchpointRowLike } from '../contact-model'
import { qualifiedSummary, type QualifiedRow } from '../qualified-summary'
import type { Segment } from '../segments'

const r = (segment: Segment, over: Partial<QualifiedRow> = {}): QualifiedRow => ({ stage: 'quoted', segment, handled: false, aiTakeover: false, ...over })
const KEYS = new Set(['quoted', 'deposit_paid'])
const KNOWN = ['new', 'contacted', 'quoted', 'deposit_paid']

describe('qualifiedSummary', () => {
  it('counts qualified guests by where they already are on the list', () => {
    const s = qualifiedSummary([
      r('replied'), r('callback_due'),
      r('clicked_link'), r('reading_site'), r('reading_site'),
      r('stale_conversation'), r('handoff_sop'), r('retry_channel'), r('new_untouched'),
    ], KEYS, KNOWN)
    expect(s).toEqual({ stageKeys: ['quoted', 'deposit_paid'], waiting: 2, moved: 3, quiet: 4 })
  })

  it('leaves out guests in other stages, handled today, in AI follow-up, set aside or not to be contacted', () => {
    const s = qualifiedSummary([
      r('replied', { stage: 'contacted' }), r('replied', { stage: null }),
      r('replied', { handled: true }), r('clicked_link', { aiTakeover: true }),
      r('nurture_future'), r('excluded'), r('not_enquiry_suspect'),
    ], KEYS, KNOWN)
    expect(s).toEqual({ stageKeys: ['quoted', 'deposit_paid'], waiting: 0, moved: 0, quiet: 0 })
  })

  it('only the qualified stages that exist in the client\'s stage list are offered to filter by, in the list\'s order', () => {
    expect(qualifiedSummary([r('replied')], new Set(['deposit_paid', 'gone_stage', 'quoted']), KNOWN)?.stageKeys).toEqual(['quoted', 'deposit_paid'])
  })

  it('no qualified stage set, or none of them in the stage list → no entry at all', () => {
    expect(qualifiedSummary([r('replied')], new Set(), KNOWN)).toBeNull()
    expect(qualifiedSummary([r('replied')], new Set(['gone_stage']), KNOWN)).toBeNull()
  })
})

const NOW = new Date('2026-09-26T00:00:00Z')
const row = (id: string, stage: string | null): ContactRowLike => ({
  id, display_name: id, primary_phone: '+64211230001', primary_email: `${id}@example.com`, do_not_contact: false, snooze_until: null, stage,
})
const tp = (contactId: string, over: Partial<TouchpointRowLike> = {}): TouchpointRowLike => ({
  contact_id: contactId, channel: 'messenger', direction: 'inbound', occurred_at: '2026-09-25T23:00:00Z', source: 'messenger', raw: null, metadata: null, ...over,
})
const stageMeta = new Map<string, StageMetaLike>([
  ['contacted', { label: '已联系', suppressed: false }],
  ['quoted', { label: '已报价', suppressed: false }],
])
// replied = we wrote first, then the guest answered
const replied = (id: string): TouchpointRowLike[] => [
  tp(id, { direction: 'outbound', occurred_at: '2026-09-25T20:00:00Z', source: 'me_manual' }),
  tp(id),
]

describe('buildPriorityView carries the summary and moves nobody', () => {
  const contacts = [row('q1', 'quoted'), row('q2', 'quoted'), row('c1', 'contacted')]
  const touchpoints = [...replied('q1'), ...replied('q2'), ...replied('c1')]
  const run = (qualifiedStageKeys?: ReadonlySet<string>) =>
    buildPriorityView({ contacts, touchpoints, stageMeta, now: NOW, qualifiedStageKeys }, (c) => c.id)

  it('two quoted guests who answered and nobody replied to → waiting 2 (the contacted one is not counted)', () => {
    expect(run(new Set(['quoted'])).qualified).toEqual({ stageKeys: ['quoted'], waiting: 2, moved: 0, quiet: 0 })
  })

  it('the lists are identical with and without the qualified stages', () => {
    const withKeys = run(new Set(['quoted']))
    const without = run()
    expect(withKeys.sections).toEqual(without.sections)
    expect(without.qualified).toBeNull()
  })
})
