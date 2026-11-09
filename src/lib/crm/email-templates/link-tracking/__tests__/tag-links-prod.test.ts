import { describe, expect, it, vi } from 'vitest'
import type { RenderFacts } from '../../facts/types'
import { tour } from '../../__tests__/fixtures'
import { classifyLink, newToken, tagLinks, type SaveTokens, type TagLinksArgs, type TokenRow } from '../tag-links-prod'

const BROCHURE = 'https://www.example.com/brochures/B-2027.pdf'
const published = { urlPattern: 'https://www.example.com/tours/{destination}/{tier}/{slug}', allToursUrl: 'https://www.example.com/china-tours' }
const config: TagLinksArgs['config'] = {
  providers: {
    linkTracking: { hosts: ['www.example.com', 'example.com'] },
    catalogue: { templateKey: 'catalogue-send', versionLabel: 'v10', url: BROCHURE, validUntil: '2026-12-31' },
    publishedTours: published,
  },
}
const facts: RenderFacts = {
  tours: [tour({ name: 'Best of China' })],
  picks: [],
  settings: published,
  linkHosts: ['www.example.com', 'example.com'],
}

function saver(error: string | null = null) {
  const saved: TokenRow[][] = []
  const save: SaveTokens = vi.fn(async (rows: TokenRow[]) => {
    saved.push(rows)
    return { error }
  })
  return { save, saved }
}

const args = (body: string): TagLinksArgs => ({ clientId: 'c1', contactId: 'k1', requestId: '22222222-2222-4222-8222-222222222222', body, config, facts })
let n = 0
const seq = () => `TOKEN${String(++n).padStart(7, '0')}`
const bestOfChina = { name: 'Best of China', destination: 'china', tier: 'discovery', slug: 'essentials' }

describe('classifyLink', () => {
  it.each([
    [BROCHURE, 'catalogue', null],
    ['https://example.com/brochures/B-2027.pdf', 'catalogue', null],
    ['https://www.example.com/tours/china/discovery/essentials?date=2027-03-11', 'tour', { ...bestOfChina, departOn: '2027-03-11' }],
    ['https://www.example.com/tours/china/discovery/essentials?date=2030-01-01', 'tour', { ...bestOfChina, departOn: null }],
    ['https://www.example.com/china-tours', 'all_tours', null],
    ['https://www.example.com/contact', 'other', null],
  ])('%s is %s', (url, kind, tourRef) => {
    expect(classifyLink(url, config, facts)).toEqual({ kind, tour: tourRef })
  })

  it('without published facts a tour link is just "other"', () => {
    expect(classifyLink('https://www.example.com/tours/china/discovery/essentials', config, null).kind).toBe('other')
  })
})

describe('tagLinks (prod)', () => {
  it('stores one row per link and returns the tokened body', async () => {
    const { save, saved } = saver()
    const out = await tagLinks(save, args(`Brochure: ${BROCHURE}\nTour: https://www.example.com/tours/china/discovery/essentials?date=2027-03-11`), seq)
    expect(out.tagged).toBe(2)
    expect(out.warning).toBeNull()
    expect(out.body).toContain(`${BROCHURE}?me=TOKEN`)
    expect(saved[0].map((r) => r.kind)).toEqual(['catalogue', 'tour'])
    expect(saved[0][0]).toMatchObject({ request_id: '22222222-2222-4222-8222-222222222222', contact_id: 'k1', client_id: 'c1' })
  })

  it('a client without link_tracking gets the body untouched and nothing stored', async () => {
    const { save } = saver()
    const out = await tagLinks(save, { ...args(BROCHURE), config: { providers: {} } }, seq)
    expect(out).toEqual({ body: BROCHURE, tagged: 0, warning: null })
    expect(save).not.toHaveBeenCalled()
  })

  it('a failed write sends the original text, with a warning', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { save } = saver('db down')
    expect(await tagLinks(save, args(BROCHURE), seq)).toEqual({ body: BROCHURE, tagged: 0, warning: 'link_tracking_failed' })
  })

  it('a save that throws is caught the same way', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const save: SaveTokens = async () => {
      throw new Error('boom')
    }
    expect(await tagLinks(save, args(BROCHURE), seq)).toEqual({ body: BROCHURE, tagged: 0, warning: 'link_tracking_failed' })
  })

  it('a re-check mismatch sends the original text, with a warning, and stores nothing', async () => {
    const { save } = saver()
    const body = 'See https://example.com/a\\b'
    expect(await tagLinks(save, args(body), seq)).toEqual({ body, tagged: 0, warning: 'link_tracking_mismatch' })
    expect(save).not.toHaveBeenCalled()
  })

  it('newToken gives 12 letters or digits, and different ones', () => {
    expect(newToken()).toMatch(/^[A-Za-z0-9]{12}$/)
    expect(new Set(Array.from({ length: 200 }, newToken)).size).toBe(200)
  })
})
