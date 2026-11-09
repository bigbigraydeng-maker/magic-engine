import { describe, expect, it } from 'vitest'
import { catalogueKey, evaluateCatalogue } from '@/lib/crm/email-templates/gates/catalogue'

// Design §5 rows 7, 8, 9: each test fails if its part of the gate is removed.

const URL = 'https://www.example.com/brochures/Brochure-2027.pdf'
const catalogue = { url: URL, validUntil: '2026-12-31' }
const expired = { today: '2027-01-01', catalogue }

function verdict(body: string, over: Partial<Parameters<typeof evaluateCatalogue>[0]> = {}) {
  return evaluateCatalogue({ texts: ['Subject', body], catalogue, today: '2026-11-09', templateUsesCatalogue: false, ...over })
}

describe('catalogue gate', () => {
  it('a valid catalogue passes, last day included', () => {
    expect(verdict(`see ${URL}`)).toEqual({ ok: true })
    expect(verdict(`see ${URL}`, { today: '2026-12-31' })).toEqual({ ok: true })
  })

  it.each([
    ['the plain link', `see ${URL}`],
    ['inside an html href', `<a href="${URL}">brochure</a>`],
    ['the host in capitals', 'see https://WWW.EXAMPLE.COM/brochures/Brochure-2027.pdf'],
    ['with a query', `see ${URL}?v=2`],
    ['with a fragment', `see ${URL}#page=3`],
    ['over http', 'see http://www.example.com/brochures/Brochure-2027.pdf'],
    ['without a scheme', 'see www.example.com/brochures/Brochure-2027.pdf'],
    ['at the end of a sentence', `see ${URL}.`],
  ])('an expired catalogue blocks %s', (_label, body) => {
    expect(verdict(body, expired)).toEqual({ ok: false, reason: 'catalogue_expired', validUntil: '2026-12-31' })
  })

  it('the footer is checked too', () => {
    expect(evaluateCatalogue({ texts: ['S', 'B', `Footer ${URL}`], templateUsesCatalogue: false, ...expired })).toMatchObject({ ok: false })
  })

  it('paths are case-sensitive: another path on the same host is another document', () => {
    expect(verdict('see https://www.example.com/brochures/brochure-2027.pdf', expired)).toEqual({ ok: true })
    expect(verdict('see https://www.example.com/tours', expired)).toEqual({ ok: true })
  })

  it('a template using {{catalogue_url}} is refused when there is no catalogue, or it is expired', () => {
    expect(verdict('Hi', { catalogue: undefined, templateUsesCatalogue: true })).toEqual({ ok: false, reason: 'catalogue_unavailable' })
    expect(verdict('Hi', { ...expired, templateUsesCatalogue: true })).toEqual({ ok: false, reason: 'catalogue_unavailable' })
    expect(verdict('Hi', { templateUsesCatalogue: true })).toEqual({ ok: true })
  })

  it('no catalogue configured: an ordinary link is just a link', () => {
    expect(verdict(`see ${URL}`, { catalogue: undefined })).toEqual({ ok: true })
  })

  it('catalogueKey', () => {
    expect(catalogueKey('https://User@Www.Example.com:443/A/b?x#y')).toBe('www.example.com/A/b')
    expect(catalogueKey('https://www.example.com')).toBe('www.example.com/')
    expect(catalogueKey('not a url')).toBeNull()
  })
})
