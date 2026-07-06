import { describe, it, expect } from 'vitest'
import { validateOutreachJson, buildOutreachPrompt, complianceFooter, type OutreachInput } from '../outreach'
import type { ProspectAnalysis } from '../analyze'

function report(overrides: Partial<ProspectAnalysis> = {}): ProspectAnalysis {
  return {
    analyzed_at: '2026-07-06T00:00:00Z',
    segment: 'core_target',
    owner_name: 'Mark',
    top_problems: ['No Google Analytics installed', 'Homepage missing a meta description'],
    email_hook: 'Your 120 five-star reviews say a lot.',
    pillars: {
      seo: { score: 40, summary: 'x' }, geo: { score: 20, summary: 'x' },
      social: { score: 30, summary: 'x' }, gbp: { score: 85, summary: 'x' },
    },
    geo_probe: { question: 'q', mentioned: false, competitors_mentioned: ['FloorFlow'] },
    social_activity: { platform: 'facebook', followers: 300, posts_last_30d: 0 },
    skips: [],
    ...overrides,
  }
}

function input(overrides: Partial<OutreachInput> = {}): OutreachInput {
  return {
    business_name: 'Oz Flooring Co', industry: 'flooring', city: 'brisbane', country: 'AU',
    domain: 'ozflooring.com.au', rating: 4.7, review_count: 120,
    ai_report: report(),
    ...overrides,
  }
}

describe('validateOutreachJson', () => {
  it('accepts a valid draft and trims the subject', () => {
    const r = validateOutreachJson({ subject: '  About your website  ', body: 'x'.repeat(60) })
    expect(r.subject).toBe('About your website')
  })

  it('rejects a missing subject', () => {
    expect(() => validateOutreachJson({ body: 'x'.repeat(60) })).toThrow(/subject/)
  })

  it('rejects a too-short body (empty-shell drafts must not reach the queue)', () => {
    expect(() => validateOutreachJson({ subject: 'Hi', body: 'short' })).toThrow(/body/)
  })
})

describe('buildOutreachPrompt', () => {
  it('grounds the prompt in real evidence: problems, GEO absence, dead social', () => {
    const p = buildOutreachPrompt(input())
    expect(p).toContain('No Google Analytics installed')
    expect(p).toContain('does not come up')
    expect(p).toContain('FloorFlow')
    expect(p).toContain('no posts in the last 30 days')
    expect(p).toContain('OWNER FIRST NAME: Mark')
  })

  it('omits GEO evidence when the brand IS mentioned (never claim absence falsely)', () => {
    const p = buildOutreachPrompt(input({
      ai_report: report({ geo_probe: { question: 'q', mentioned: true, competitors_mentioned: [] } }),
    }))
    expect(p).not.toContain('does not come up')
  })

  it('degrades to the generic angle when there are no problems', () => {
    const p = buildOutreachPrompt(input({ ai_report: report({ top_problems: [], email_hook: '' }) }))
    expect(p).toContain('keep the email generic')
    expect(p).toContain('4.7★ from 120 customers')
  })
})

describe('complianceFooter', () => {
  it('carries identity, reason, and an opt-out (AU Spam Act / NZ UEM)', () => {
    const f = complianceFooter()
    expect(f).toMatch(/Magic Engine/)
    expect(f).toMatch(/publicly listed/)
    expect(f).toMatch(/unsubscribe/i)
  })
})
