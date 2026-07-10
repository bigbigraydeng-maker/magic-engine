import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/anthropic/client', () => ({
  callClaudeChat: vi.fn(),
  parseJsonResponse: (text: string) => JSON.parse(text),
}))

import { callClaudeChat } from '@/lib/anthropic/client'
import {
  validateOutreachJson, buildOutreachPrompt, complianceFooter,
  sanitiseOwnerName, generateOutreachEmail, senderIdentity, type OutreachInput,
} from '../outreach'
import type { ProspectAnalysis } from '../analyze'
import type { LeakReport } from '../report'

const mockClaude = vi.mocked(callClaudeChat)

function leakReport(summary_points: string[]): LeakReport {
  return {
    generated_at: '2026-07-06T00:00:00Z',
    business_name: 'Oz Flooring Co',
    headline: `${summary_points.length} places where enquiries are leaking`,
    leak_count: summary_points.length,
    health_score: 40,
    verdict: 'Leaking enquiries',
    stages: [],
    summary_points,
  }
}

beforeEach(() => { vi.clearAllMocks() })

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
    expect(p).toContain("didn't get a mention")
    expect(p).toContain('FloorFlow')
    expect(p).toContain('no posts in the last 30 days')
    expect(p).toContain('OWNER FIRST NAME: Mark')
  })

  it('phrases the GEO evidence as time-boxed ("when we asked ChatGPT"), never absolute', () => {
    const p = buildOutreachPrompt(input())
    expect(p).toContain('when we asked ChatGPT')
    expect(p).not.toContain('does not come up')
  })

  it('omits GEO evidence when the brand IS mentioned (never claim absence falsely)', () => {
    const p = buildOutreachPrompt(input({
      ai_report: report({ geo_probe: { question: 'q', mentioned: true, competitors_mentioned: [] } }),
    }))
    expect(p).not.toContain("didn't get a mention")
  })

  it('degrades to the generic angle when there are no problems', () => {
    const p = buildOutreachPrompt(input({ ai_report: report({ top_problems: [], email_hook: '' }) }))
    expect(p).toContain('keep the email generic')
    expect(p).toContain('120 reviews at 4.7★')
  })

  it('drops a doubtful owner name instead of risking the wrong greeting', () => {
    const p = buildOutreachPrompt(input({
      business_name: 'Dave Smith Flooring',
      ai_report: report({ owner_name: 'Dave' }),   // "Dave" is the brand, not verified person
    }))
    expect(p).toContain('OWNER FIRST NAME: unknown')
  })

  it('leads with the lead-leakage angle and uses the report summary points when present', () => {
    const leak = leakReport([
      "There's no enquiry form or visible email on your homepage.",
      'Your Facebook page hasn\'t posted in over a month.',
    ])
    const p = buildOutreachPrompt(input({ leak_report: leak }))
    expect(p).toContain('where enquiries are quietly slipping away')
    expect(p).toContain('no enquiry form or visible email')
    expect(p).toContain("hasn't posted in over a month")
    // The leak path supersedes the piecemeal fallback evidence assembly.
    expect(p).not.toContain('EVIDENCE — problems we can name')
    expect(p).toContain('OWNER FIRST NAME: Mark')
  })

  it('falls back to the original evidence path when the leak report has no findings', () => {
    const p = buildOutreachPrompt(input({ leak_report: leakReport([]) }))
    expect(p).toContain('EVIDENCE — problems we can name')
    expect(p).not.toContain('quietly slipping away')
  })
})

describe('sanitiseOwnerName', () => {
  it('keeps a plausible first name, stripping titles and surnames', () => {
    expect(sanitiseOwnerName('Dr Sarah Nguyen (Director)', 'Brisbane Dental Studio')).toBe('Sarah')
  })

  it('rejects a name that overlaps the business name (brand, not person)', () => {
    expect(sanitiseOwnerName('Smith', 'Smith & Jones Plumbing')).toBeNull()
  })

  it('rejects null / empty / absurd inputs', () => {
    expect(sanitiseOwnerName(null, 'X')).toBeNull()
    expect(sanitiseOwnerName('  ', 'X')).toBeNull()
    expect(sanitiseOwnerName('A', 'X')).toBeNull()
  })
})

describe('senderIdentity', () => {
  const saved = {
    name: process.env.OUTREACH_SENDER_NAME,
    first: process.env.OUTREACH_SENDER_FIRST_NAME,
  }
  afterEach(() => {
    for (const [k, v] of [['OUTREACH_SENDER_NAME', saved.name], ['OUTREACH_SENDER_FIRST_NAME', saved.first]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v
    }
  })

  it('defaults to a real person (Big Ray Deng / Big Ray) and counts as configured', () => {
    delete process.env.OUTREACH_SENDER_NAME
    delete process.env.OUTREACH_SENDER_FIRST_NAME
    const id = senderIdentity()
    expect(id.name).toBe('Big Ray Deng')
    expect(id.firstName).toBe('Big Ray')      // not "Big" from a naive split
    expect(id.configured).toBe(true)
  })

  it('lets env override the name, deriving the first token when no first-name override', () => {
    process.env.OUTREACH_SENDER_NAME = 'Jane Smith'
    delete process.env.OUTREACH_SENDER_FIRST_NAME
    const id = senderIdentity()
    expect(id.name).toBe('Jane Smith')
    expect(id.firstName).toBe('Jane')
  })

  it('still flags the generic team signature as unconfigured', () => {
    process.env.OUTREACH_SENDER_NAME = 'The Magic Engine Team'
    expect(senderIdentity().configured).toBe(false)
  })
})

describe('complianceFooter', () => {
  it('carries identity, website, reason, and an opt-out (AU Spam Act / NZ UEM)', () => {
    const f = complianceFooter('Oz Flooring Co')
    expect(f).toMatch(/Magic Engine/)
    expect(f).toMatch(/magicengine/)
    expect(f).toContain('Oz Flooring Co')
    expect(f).toContain('public Google Business listing')
    expect(f).toMatch(/reply "no thanks"/)
    expect(f).toContain("won't hear from us again")
  })

  it('offers a one-click unsubscribe link placeholder alongside the reply option', () => {
    expect(complianceFooter('Oz Flooring Co')).toContain('{{unsubscribe_url}}')
  })

  it('emits a substitutable template when no business name is given', () => {
    const t = complianceFooter()
    expect(t).toContain('{{business_name}}')
    expect(t).toContain('{{unsubscribe_url}}')
  })
})

describe('generateOutreachEmail', () => {
  it('returns a draft with the segment as angle', async () => {
    mockClaude.mockResolvedValue({ text: JSON.stringify({ subject: 'About your flooring store', body: 'x'.repeat(80) }), tokens_in: 1, tokens_out: 1, cost_usd: 0 })
    const email = await generateOutreachEmail(input())
    expect(email.subject).toBe('About your flooring store')
    expect(email.angle).toBe('core_target')
  })

  it('throws (caller retries) when the model returns a malformed draft', async () => {
    mockClaude.mockResolvedValue({ text: '{"subject": "hi"}', tokens_in: 1, tokens_out: 1, cost_usd: 0 })
    await expect(generateOutreachEmail(input())).rejects.toThrow(/body/)
  })

  it('propagates model failure instead of fabricating a draft', async () => {
    mockClaude.mockRejectedValue(new Error('overloaded'))
    await expect(generateOutreachEmail(input())).rejects.toThrow('overloaded')
  })
})
