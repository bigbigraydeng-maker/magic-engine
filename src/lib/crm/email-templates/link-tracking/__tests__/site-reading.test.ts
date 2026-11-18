/**
 * 「正在看手册」：从真人点击 / 官网页面浏览算出谁这几天在看，然后员工名单把他放进那一组（在线手册第四刀）。
 */

import { describe, expect, it } from 'vitest'
import type { PublishedTourFact } from '@/lib/tour-catalog/publish-contract'
import { buildContactModel, type ContactRowLike, type TouchpointRowLike } from '../../../contact-model'
import { buildPriorityView } from '../../../contact-list-view'
import { isReadingSite, segmentContact, siteReadingReason, type SiteReading } from '../../../segments'
import { WORKLIST_GROUPS } from '../../../worklist-groups'
import type { PageLabelFacts, TokenRead } from '../click-summary'
import { countVisits, summariseSiteReading, type ClickForReading } from '../site-reading'

const NOW = new Date('2026-11-18T03:00:00.000Z')
const H = 3_600_000

const fact = (slug: string, name: string): PublishedTourFact => ({
  id: slug, slug, destination: 'china', tier: 'discovery', name, title: null,
  durationText: '15 Days', displayPriceText: null, highlights: [], inclusions: [], exclusions: [], singleSupplement: null,
  soldOut: false, managesDepartures: false, isActive: true, departures: [],
})
const pattern = 'https://www.ctstours.co.nz/tours/{destination}/{tier}/{slug}'
const page: PageLabelFacts = {
  urlPattern: pattern,
  hosts: ['www.ctstours.co.nz'],
  facts: {
    tours: [fact('essentials', 'Best of China'), fact('yunnan', 'Yunnan Explorer')],
    picks: [],
    settings: { urlPattern: pattern, allToursUrl: 'https://www.ctstours.co.nz/china-tours' },
    linkHosts: ['www.ctstours.co.nz'],
  },
}
const brochureToken: TokenRead = { token: 'BBBBBBBBBBBB', request_id: 'r1', url: 'https://www.ctstours.co.nz/brochure', kind: 'other', tour: null }
const at = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * H).toISOString()
const click = (contact: string, path: string | null, hoursAgo: number): ClickForReading => ({ contact_id: contact, token: brochureToken.token, path, occurred_at: at(hoursAgo) })

describe('summariseSiteReading', () => {
  it('names the tours a guest opened and counts separate brochure visits', () => {
    const out = summariseSiteReading(
      [
        click('c1', null, 30),
        click('c1', '/tours/china/discovery/essentials', 29),
        click('c1', '/tours/china/yunnan-not-a-tour', 29),
        click('c1', '/brochure', 2),
        click('c1', '/tours/china/discovery/yunnan?date=2027-03-01', 1),
      ],
      [brochureToken],
      page,
      NOW,
    )
    expect(out.get('c1')).toEqual({ tours: ['Best of China', 'Yunnan Explorer'], brochureVisits: 2, lastAt: at(1) })
  })

  it('ignores visits older than 7 days, in the future, or on tokens it cannot read', () => {
    const out = summariseSiteReading(
      [click('c1', '/tours/china/discovery/essentials', 7 * 24 + 1), click('c1', '/brochure', -1), { ...click('c2', null, 1), token: 'ZZZZZZZZZZZZ' }],
      [brochureToken],
      page,
      NOW,
    )
    expect(out.size).toBe(0)
  })

  it('a burst of page loads in one sitting is one visit', () => {
    expect(countVisits([0, 1 * H, 3 * H, 7.9 * H])).toBe(1)
    expect(countVisits([0, 8 * H])).toBe(2)
    expect(countVisits([])).toBe(0)
  })
})

const row = (id: string): ContactRowLike => ({
  id, display_name: id, primary_phone: '+64211230001', primary_email: `${id}@example.com`, do_not_contact: false, snooze_until: null, stage: null,
})
const enquiry = (id: string, occurred_at: string): TouchpointRowLike => ({
  contact_id: id, channel: 'web_form', direction: 'inbound', occurred_at, source: 'web_form', raw: null, metadata: null,
})
const staffCall = (id: string, occurred_at: string): TouchpointRowLike => ({
  contact_id: id, channel: 'phone', direction: 'outbound', occurred_at, source: 'manual', raw: null, metadata: { outcome: 'spoke' },
})
const reading = (r: Partial<SiteReading>): SiteReading => ({ tours: [], brochureVisits: 1, lastAt: at(2), ...r })

describe('「正在看手册」这一组', () => {
  const model = (tps: TouchpointRowLike[], r: SiteReading | null) => ({ ...buildContactModel(row('c1'), tps, new Map()), siteReading: r })

  it('threshold: two tours, or came back to the brochure', () => {
    expect(isReadingSite(reading({ tours: ['A'] }))).toBe(false)
    expect(isReadingSite(reading({ tours: ['A', 'B'] }))).toBe(true)
    expect(isReadingSite(reading({ brochureVisits: 2 }))).toBe(true)
    expect(isReadingSite(null)).toBe(false)
  })

  it('a guest we called weeks ago who is now reading goes into the group, with what he read on the card', () => {
    const seg = segmentContact(model([enquiry('c1', at(30 * 24)), staffCall('c1', at(29 * 24))], reading({ tours: ['Best of China', 'Yunnan Explorer'] })), NOW)
    expect(seg.segment).toBe('reading_site')
    expect(seg.temperature).toBe('hot')
    expect(seg.reason).toBe('这几天在官网看了 Best of China、Yunnan Explorer，之后没人联系过他')
  })

  it('not once a person has called him after he read', () => {
    const seg = segmentContact(model([enquiry('c1', at(30 * 24)), staffCall('c1', at(1))], reading({ tours: ['A', 'B'], lastAt: at(2) })), NOW)
    expect(seg.segment).not.toBe('reading_site')
  })

  it('one tour page only is not enough', () => {
    const seg = segmentContact(model([enquiry('c1', at(30 * 24)), staffCall('c1', at(29 * 24))], reading({ tours: ['A'] })), NOW)
    expect(seg.segment).not.toBe('reading_site')
  })

  it('a guest who wrote to us still sits in 「客户回话了」 above it', () => {
    const tps = [enquiry('c1', at(30 * 24)), staffCall('c1', at(29 * 24)), { ...enquiry('c1', at(1)), channel: 'email', source: 'microsoft_mail' }]
    expect(segmentContact(model(tps, reading({ brochureVisits: 3 })), NOW).segment).toBe('replied')
  })

  it('the reason line lists at most three tours and the return visits', () => {
    expect(siteReadingReason(reading({ tours: ['A', 'B', 'C', 'D'], brochureVisits: 2 }))).toBe('这几天在官网看了 A、B、C 等 4 个团，2 次回来翻手册，之后没人联系过他')
  })

  it('has a column on the today board, and lands in 「今天要联系」 on the all-guests page', () => {
    expect(WORKLIST_GROUPS.some((g) => g.members.includes('reading_site'))).toBe(true)
    const { sections } = buildPriorityView(
      {
        contacts: [row('c1')],
        touchpoints: [enquiry('c1', at(30 * 24)), staffCall('c1', at(29 * 24))],
        stageMeta: new Map(),
        now: NOW,
        siteReading: new Map([['c1', reading({ brochureVisits: 2 })]]),
      },
      (_r, ranked) => ranked.seg.segment,
    )
    expect(JSON.stringify(sections)).toContain('reading_site')
  })
})
