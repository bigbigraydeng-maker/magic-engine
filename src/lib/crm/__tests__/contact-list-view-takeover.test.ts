/**
 * 「全部客人」两张名单 + AI 接管：接管中的客人从「今天要联系」挪到「先放着」（不消失），
 * 客人回来了就留在「今天要联系」并标「客人回来了」。
 */
import { describe, expect, it } from 'vitest'
import { buildPriorityView } from '../contact-list-view'
import type { ContactRowLike, TouchpointRowLike } from '../contact-model'
import { TAKEOVER_REASON } from '../ai-takeover/day-list-filter'

const NOW = new Date('2026-11-10T03:00:00Z')
const DAY_START = Date.parse('2026-11-09T11:00:00Z') // 10 Nov 00:00 Auckland
const SINCE = '2026-11-05T00:00:00Z'

function row(id: string): ContactRowLike {
  return {
    id, display_name: id, primary_phone: '+64211230001', primary_email: `${id}@example.com`,
    do_not_contact: false, snooze_until: null, stage: null,
  }
}

function reply(contactId: string, at: string): TouchpointRowLike {
  return { contact_id: contactId, channel: 'email', direction: 'inbound', occurred_at: at, source: 'outlook', raw: 'Still have March?', metadata: null }
}

function view(takeoverSince?: Map<string, string>, touchpoints: TouchpointRowLike[] = []) {
  const out = buildPriorityView(
    {
      contacts: [row('quiet'), row('back'), row('plain')],
      touchpoints,
      stageMeta: new Map(),
      now: NOW,
      open: { hot: true, cold: true },
      dayStartMs: DAY_START,
      touchedToday: new Set(),
      takeoverSince,
    },
    (r, ranked) => ({ id: r.id, reason: ranked.seg.reason, aiTakeover: ranked.aiTakeover, cameBack: ranked.customerCameBack }),
  )
  const items = (key: 'hot' | 'cold') => out.sections.find((s) => s.key === key)?.items ?? []
  return { hot: items('hot'), cold: items('cold') }
}

describe('buildPriorityView + AI takeover', () => {
  it('without takeover everyone new is in "今天要联系"', () => {
    expect(view().hot.map((r) => r.id).sort()).toEqual(['back', 'plain', 'quiet'])
  })

  it('in takeover and not back → moved to "先放着" with the reason; nobody vanishes', () => {
    const v = view(new Map([['quiet', SINCE]]))
    expect(v.hot.map((r) => r.id)).not.toContain('quiet')
    expect(v.cold.find((r) => r.id === 'quiet')).toMatchObject({ reason: TAKEOVER_REASON, aiTakeover: true, cameBack: false })
  })

  it('came back after takeover-on → stays in "今天要联系", tagged, still in takeover', () => {
    const v = view(new Map([['back', SINCE]]), [reply('back', '2026-11-09T20:00:00Z')])
    expect(v.hot.find((r) => r.id === 'back')).toMatchObject({ aiTakeover: true, cameBack: true })
  })

  it('a reply from before takeover-on does not count as coming back', () => {
    const v = view(new Map([['back', SINCE]]), [reply('back', '2026-11-04T20:00:00Z')])
    expect(v.cold.find((r) => r.id === 'back')).toMatchObject({ aiTakeover: true, cameBack: false })
  })
})
