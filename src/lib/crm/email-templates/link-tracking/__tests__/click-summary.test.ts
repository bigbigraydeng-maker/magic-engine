import { describe, expect, it } from 'vitest'
import { clickLabel, pageViewLabel, timelineClicks, type PageLabelFacts, type TokenRead } from '../click-summary'
import type { PublishedTourFact } from '@/lib/tour-catalog/publish-contract'

describe('clickLabel', () => {
  const tour = { name: 'Best of China', destination: 'china', tier: 'discovery', slug: 'essentials', departOn: '2027-03-11' }

  it.each([
    ['catalogue', null, 'https://x/b.pdf', '目录'],
    ['all_tours', null, 'https://x/china-tours', '全部团页面'],
    ['tour', tour, 'https://x/tours/china/discovery/essentials?date=2027-03-11', 'Best of China（11 Mar 出发）'],
    ['tour', { ...tour, departOn: null }, 'https://x/tours/china/discovery/essentials', 'Best of China'],
    ['other', null, 'https://www.x.com/contact?a=1', '/contact'],
    ['other', null, 'www.x.com/about', '/about'],
  ] as const)('%s → %s', (kind, t, url, label) => {
    expect(clickLabel(kind, t, url)).toBe(label)
  })
})

describe('site page views on the timeline', () => {
  const tourFact: PublishedTourFact = {
    id: 't1', slug: 'essentials', destination: 'china', tier: 'discovery', name: 'Best of China', title: null,
    durationText: '15 Days', displayPriceText: null, highlights: [], inclusions: [], exclusions: [], singleSupplement: null,
    soldOut: false, managesDepartures: false, isActive: true, departures: [],
  }
  const pattern = 'https://www.ctstours.co.nz/tours/{destination}/{tier}/{slug}'
  const page: PageLabelFacts = {
    urlPattern: pattern,
    hosts: ['www.ctstours.co.nz'],
    facts: { tours: [tourFact], picks: [], settings: { urlPattern: pattern, allToursUrl: 'https://www.ctstours.co.nz/china-tours' }, linkHosts: ['www.ctstours.co.nz'] },
  }
  const catalogueToken: TokenRead = { token: 'AAAAAAAAAAAA', request_id: 'r1', url: 'https://www.ctstours.co.nz/brochures/b.pdf', kind: 'catalogue', tour: null }

  it('labels a tour page by its name, the list page, or the bare path', () => {
    expect(pageViewLabel('/tours/china/discovery/essentials', page)).toBe('在官网看了 Best of China')
    expect(pageViewLabel('/china-tours', page)).toBe('在官网看了全部团')
    expect(pageViewLabel('/about?x=1', page)).toBe('在官网看了 /about')
    expect(pageViewLabel('/tours/china/discovery/essentials', { urlPattern: null, hosts: [], facts: null })).toBe('在官网看了 /tours/china/discovery/essentials')
  })

  it('one line for the mail link, one per later page, each at its first visit', () => {
    const lines = timelineClicks(
      [
        { token: 'AAAAAAAAAAAA', path: '/brochures/b.pdf', occurred_at: '2026-11-18T01:00:00Z' },
        { token: 'AAAAAAAAAAAA', path: '/tours/china/discovery/essentials', occurred_at: '2026-11-18T01:03:00Z' },
        { token: 'AAAAAAAAAAAA', path: '/tours/china/discovery/essentials', occurred_at: '2026-11-20T09:00:00Z' },
        { token: 'BBBBBBBBBBBB', path: '/x', occurred_at: '2026-11-20T09:00:00Z' },
      ],
      [catalogueToken],
      page,
    )
    expect(lines).toEqual([
      { at: '2026-11-18T01:00:00Z', label: '目录' },
      { at: '2026-11-18T01:03:00Z', label: '在官网看了 Best of China' },
    ])
  })
})
