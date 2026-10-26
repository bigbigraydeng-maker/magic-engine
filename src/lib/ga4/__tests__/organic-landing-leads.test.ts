import { describe, expect, it } from 'vitest'
import { classifyLanding, summariseOrganicLandingLeads, type LandingClassConfig, type OrganicLandingLeadsRaw } from '../organic-landing-leads'
import { getLandingClassConfig } from '../landing-class-config'

const CFG: LandingClassConfig = { productPrefixes: ['/tours/', '/campaigns/'], guideContains: ['-travel-guide', '/blog'], enquiryEvent: 'enquiry_thank_you', thankYouPathContains: 'thank' }
const base = { periodStart: '2026-09-15', periodEnd: '2026-10-13', truncated: false }
const row = (channel: string, landingPath: string, event: string, events: number) => ({ channel, landingPath, event, events, users: events })

describe('classifyLanding', () => {
  it('product / guide / other by configured rules', () => {
    expect(classifyLanding('/tours/china/discovery/x', CFG)).toBe('product')
    expect(classifyLanding('/campaigns/best-of-china', CFG)).toBe('product')
    expect(classifyLanding('/beijing-travel-guide', CFG)).toBe('guide')
    expect(classifyLanding('/about', CFG)).toBe('other')
  })
  it('a guide URL that merely contains "tours" is not a product page', () => {
    expect(classifyLanding('/china-tours-from-new-zealand', CFG)).toBe('other')
  })
})

describe('summariseOrganicLandingLeads', () => {
  it('counts only Organic Search and keeps new-event and legacy page-view columns apart', () => {
    const raw: OrganicLandingLeadsRaw = {
      ...base,
      rows: [
        row('Organic Search', '/tours/a', 'enquiry_thank_you', 2),
        row('Organic Search', '/tours/a', 'thank_you_page_view', 1),
        row('Organic Search', '/beijing-travel-guide', 'enquiry_thank_you', 1),
        row('Paid Search', '/tours/a', 'enquiry_thank_you', 50),
      ],
    }
    const s = summariseOrganicLandingLeads(raw, CFG)
    const product = s.buckets.find(b => b.landingClass === 'product')
    expect(product).toMatchObject({ enquiryEvent: 2, thankYouPageView: 1 })
    expect(s.buckets.find(b => b.landingClass === 'guide')?.enquiryEvent).toBe(1)
    expect(s.buckets.reduce((n, b) => n + b.enquiryEvent, 0)).toBe(3) // paid row excluded
  })
  it('the one-line summary leads with the primary count and does not assume the number is small', () => {
    const s = summariseOrganicLandingLeads({ ...base, rows: [row('Organic Search', '/tours/a', 'enquiry_thank_you', 40)] }, CFG)
    expect(s.plain).toContain('enquiry_thank_you 共 40 次（主口径）')
    expect(s.plain).not.toContain('数字很小')
  })
  it('says what is missing instead of inventing numbers', () => {
    const s = summariseOrganicLandingLeads({ ...base, rows: [], truncated: true }, CFG)
    const text = s.missing.join('|')
    expect(text).toContain('viewed_tour_paths')
    expect(text).toContain('enquiry_thank_you')
    expect(text).toContain('上限')
  })
  it('the REAL CTS configuration classifies real CTS URL shapes; any other client id has none', () => {
    const cts = getLandingClassConfig('c0000000-0000-0000-0000-000000000000')!
    expect(classifyLanding('/tours/china/discovery/beijing-xian', cts)).toBe('product')
    expect(classifyLanding('/campaigns/october-2026/beijing-xian', cts)).toBe('product')
    expect(classifyLanding('/beijing-travel-guide', cts)).toBe('guide')
    expect(classifyLanding('/china-visa-guide-for-new-zealanders', cts)).toBe('guide')
    expect(classifyLanding('/china-tours-from-new-zealand', cts)).toBe('other')
    expect(getLandingClassConfig('d5c98811-1c1d-4ded-bdf0-4cefec6afb84')).toBeNull()
  })
})
