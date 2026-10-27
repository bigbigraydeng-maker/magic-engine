import { describe, it, expect, vi } from 'vitest'
import {
  evaluateContentGates,
  findResidueMarkers,
  extractLinks,
  type ContentGateInput,
} from '@/lib/crm/email-templates/gates/content-gates'
import type { EmailSettings } from '@/lib/crm/email-templates/types'
import type {
  FactProvider,
  RenderFacts,
  LinkViolation,
} from '@/lib/crm/email-templates/facts/types'

function settings(overrides: Partial<EmailSettings> = {}): EmailSettings {
  return {
    enabled: true,
    sendMailbox: null,
    allowUnsolicited: false,
    footer: null,
    limits: { perUserPerHour: 10, perUserPerDay: 50, perMailboxPerDay: 200 },
    frequencyCap: null,
    recipientAllowlist: null,
    sameTemplateCooldownHours: 24,
    callPromptHours: 24,
    guardrails: {
      allowedLinkHosts: ['example.com', 'www.example.com'],
      rules: [
        {
          id: 'no-visa-free',
          phrases: ['visa-free', 'visa free', 'no visa required'],
          message: '请勿承诺免签',
          severity: 'block',
        },
        {
          id: 'no-urgency',
          phrases: ['hurry up', 'last chance', 'seats left'],
          message: '请勿制造紧迫感',
          severity: 'block',
        },
        {
          id: 'no-call',
          phrases: ['give me a call', 'schedule a call'],
          message: '请勿要求电话',
          severity: 'warn',
        },
      ],
    },
    providers: {},
    ...overrides,
  }
}

function stubProvider(): FactProvider {
  return {
    id: 'published_tours',
    variables: {},
    resolve: () => ({ ok: false, missing: 'stub' }),
    checkLinks: (urls: readonly string[]): LinkViolation[] => {
      const out: LinkViolation[] = []
      for (const url of urls) {
        if (url.includes('/sold-out')) {
          out.push({
            url,
            code: 'tour_page_not_on_sale',
            detail: '行程已下架',
          })
        }
      }
      return out
    },
    knownAmounts: () => ['4080'],
    sellable: () => ({ ok: true }),
  }
}

function facts(picks: RenderFacts['picks'] = []): RenderFacts {
  return { tours: [], picks, settings: null }
}

function input(overrides: Partial<ContentGateInput> = {}): ContentGateInput {
  return {
    subject: 'Hello',
    body: 'A clean message.',
    footer: null,
    settings: settings(),
    provider: null,
    facts: null,
    ...overrides,
  }
}

describe('evaluateContentGates - clean', () => {
  it('returns no blocks and no warnings for a clean message', () => {
    const result = evaluateContentGates(input())
    expect(result.blocks).toEqual([])
    expect(result.warnings).toEqual([])
  })
})

describe('evaluateContentGates - phrase obfuscation', () => {
  const variants = [
    'Visa-Free',
    'visa\u2011free',
    'vi\u200Bsa-free',
    'visa-\nfree',
    'ｖｉｓａ-ｆｒｅｅ',
    'visa&#8209;free',
    'visa%2Dfree',
  ]
  for (const variant of variants) {
    it(`blocks ${JSON.stringify(variant)} with ruleId no-visa-free`, () => {
      const result = evaluateContentGates(input({ body: `We offer ${variant} entry.` }))
      const hit = result.blocks.find((b) => b.ruleId === 'no-visa-free')
      expect(hit).toBeDefined()
      expect(hit?.code).toBe('content_blocked')
    })
  }

  it('does not trigger hurry up from "no hurry at all"', () => {
    const result = evaluateContentGates(input({ body: 'There is no hurry at all.' }))
    expect(result.blocks.find((b) => b.ruleId === 'no-urgency')).toBeUndefined()
  })

  it('triggers hurry up from "hurry up!"', () => {
    const result = evaluateContentGates(input({ body: 'Hurry up!' }))
    expect(result.blocks.find((b) => b.ruleId === 'no-urgency')).toBeDefined()
  })

  it('catches a phrase inside the footer', () => {
    const result = evaluateContentGates(
      input({ body: 'Fine.', footer: 'Hurry up and book.' }),
    )
    expect(result.blocks.find((b) => b.ruleId === 'no-urgency')).toBeDefined()
  })

  it('catches a phrase inside the subject', () => {
    const result = evaluateContentGates(input({ subject: 'Hurry up', body: 'Fine.' }))
    expect(result.blocks.find((b) => b.ruleId === 'no-urgency')).toBeDefined()
  })

  it('warn rule produces a warning, not a block', () => {
    const result = evaluateContentGates(
      input({ body: 'Please schedule a call with us.' }),
    )
    expect(result.blocks.find((b) => b.ruleId === 'no-call')).toBeUndefined()
    const warn = result.warnings.find((w) => w.ruleId === 'no-call')
    expect(warn).toBeDefined()
    expect(warn?.code).toBe('content_warning')
  })
})

describe('evaluateContentGates - links', () => {
  it('accepts https://example.com/x', () => {
    const result = evaluateContentGates(input({ body: 'See https://example.com/x' }))
    expect(result.blocks).toEqual([])
  })

  it('accepts https://www.example.com', () => {
    const result = evaluateContentGates(input({ body: 'See https://www.example.com' }))
    expect(result.blocks).toEqual([])
  })

  it('blocks http://example.com as link_not_https', () => {
    const result = evaluateContentGates(input({ body: 'See http://example.com' }))
    expect(result.blocks.some((b) => b.code === 'link_not_https')).toBe(true)
  })

  it('blocks https://evil.example.com.evil.com as link_host_not_allowed', () => {
    const result = evaluateContentGates(
      input({ body: 'See https://evil.example.com.evil.com' }),
    )
    expect(result.blocks.some((b) => b.code === 'link_host_not_allowed')).toBe(true)
  })

  it('blocks https://example.com.evil.com as link_host_not_allowed', () => {
    const result = evaluateContentGates(
      input({ body: 'See https://example.com.evil.com' }),
    )
    expect(result.blocks.some((b) => b.code === 'link_host_not_allowed')).toBe(true)
  })

  it('blocks https://user@example.com as link_userinfo', () => {
    const result = evaluateContentGates(
      input({ body: 'See https://user@example.com' }),
    )
    expect(result.blocks.some((b) => b.code === 'link_userinfo')).toBe(true)
  })

  it('accepts https://EXAMPLE.com (case-insensitive host)', () => {
    const result = evaluateContentGates(input({ body: 'See https://EXAMPLE.com' }))
    expect(result.blocks).toEqual([])
  })

  it('blocks www.evil.com/page as link_host_not_allowed', () => {
    const result = evaluateContentGates(input({ body: 'See www.evil.com/page' }))
    expect(result.blocks.some((b) => b.code === 'link_host_not_allowed')).toBe(true)
  })

  it('blocks bare evil.com as link_host_not_allowed', () => {
    const result = evaluateContentGates(input({ body: 'See evil.com' }))
    expect(result.blocks.some((b) => b.code === 'link_host_not_allowed')).toBe(true)
  })

  it('accepts bare example.com/tours', () => {
    const result = evaluateContentGates(input({ body: 'See example.com/tours' }))
    expect(result.blocks).toEqual([])
  })

  it('does not treat info@example.com as a link', () => {
    const result = evaluateContentGates(input({ body: 'Email info@example.com' }))
    expect(result.blocks).toEqual([])
  })

  it('does not treat info@evil.com as a link', () => {
    const result = evaluateContentGates(input({ body: 'Email info@evil.com' }))
    expect(result.blocks).toEqual([])
  })

  it('does not treat "Ms.Lee said e.g. hello" as a link', () => {
    const result = evaluateContentGates(
      input({ body: 'Ms.Lee said e.g. hello' }),
    )
    expect(result.blocks).toEqual([])
  })

  it('blocks https://example.com when allowedLinkHosts is empty', () => {
    const result = evaluateContentGates(
      input({
        body: 'See https://example.com',
        settings: settings({
          guardrails: {
            allowedLinkHosts: [],
            rules: settings().guardrails.rules,
          },
        }),
      }),
    )
    expect(result.blocks.some((b) => b.code === 'link_host_not_allowed')).toBe(true)
  })

  it('accepts a trailing period after a link', () => {
    const result = evaluateContentGates(
      input({ body: 'See https://example.com.' }),
    )
    expect(result.blocks).toEqual([])
  })
})

describe('evaluateContentGates - provider link check', () => {
  it('adds tour_page_not_on_sale for a /sold-out url', () => {
    const result = evaluateContentGates(
      input({
        body: 'See https://example.com/sold-out',
        provider: stubProvider(),
        facts: facts([{ tour: {} as never, departure: null }]),
      }),
    )
    expect(result.blocks.some((b) => b.code === 'tour_page_not_on_sale')).toBe(true)
  })

  it('does not call provider.checkLinks when facts is null', () => {
    const provider = stubProvider()
    const spy = vi.spyOn(provider, 'checkLinks')
    evaluateContentGates(
      input({
        body: 'See https://example.com/sold-out',
        provider,
        facts: null,
      }),
    )
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('findResidueMarkers', () => {
  const cases = [
    '{{x}}',
    '{first_name}',
    '*|FNAME|*',
    '[Lisa to confirm: price]',
    '(TBC)',
    'TBD',
    '待确认',
  ]
  for (const text of cases) {
    it(`flags ${JSON.stringify(text)} as placeholder_left`, () => {
      const result = findResidueMarkers(text)
      expect(result.length).toBeGreaterThan(0)
      expect(result.every((v) => v.code === 'placeholder_left')).toBe(true)
    })
  }

  it('does not flag "Please confirm by replying"', () => {
    const result = findResidueMarkers('Please confirm by replying')
    expect(result).toEqual([])
  })
})

describe('evaluateContentGates - amount drift', () => {
  it('accepts $4,080 when it is in the catalog', () => {
    const result = evaluateContentGates(
      input({
        body: 'Price is $4,080.',
        provider: stubProvider(),
        facts: facts([{ tour: {} as never, departure: null }]),
      }),
    )
    expect(result.warnings.find((w) => w.code === 'amount_not_in_catalog')).toBeUndefined()
  })

  it('warns once for $9,999 listing it', () => {
    const result = evaluateContentGates(
      input({
        body: 'Price is $9,999.',
        provider: stubProvider(),
        facts: facts([{ tour: {} as never, departure: null }]),
      }),
    )
    const warns = result.warnings.filter((w) => w.code === 'amount_not_in_catalog')
    expect(warns).toHaveLength(1)
    expect(warns[0].detail).toContain('9999')
  })

  it('does not warn when facts.picks is empty', () => {
    const result = evaluateContentGates(
      input({
        body: 'Price is $9,999.',
        provider: stubProvider(),
        facts: facts([]),
      }),
    )
    expect(result.warnings.find((w) => w.code === 'amount_not_in_catalog')).toBeUndefined()
  })
})

describe('extractLinks', () => {
  it('extracts a mixed sample', () => {
    const links = extractLinks(
      'see https://example.com/a and www.example.com/b and example.com/c and info@example.com',
    )
    expect(links).toContain('https://example.com/a')
    expect(links).toContain('https://www.example.com/b')
    expect(links).toContain('https://example.com/c')
    expect(links.some((l) => l.includes('info@'))).toBe(false)
  })
})

describe('regressions found in review', () => {
  it('"please confirm" in ordinary brackets is not residue', () => {
    expect(findResidueMarkers('Please send your details (confirm by replying to this email).')).toEqual([])
    expect(findResidueMarkers('[Lisa to confirm: guaranteed departure]').length).toBeGreaterThan(0)
  })

  it('a bare Chinese internal marker is residue even without brackets', () => {
    expect(findResidueMarkers('价格 待确认').length).toBeGreaterThan(0)
    expect(findResidueMarkers('待补充').length).toBeGreaterThan(0)
  })

  it('a URL with credentials is not swallowed as an email address', () => {
    expect(extractLinks('go to https://user@example.com now')).toEqual(['https://user@example.com'])
    expect(extractLinks('mail info@example.com or visit www.example.com')).toEqual(['https://www.example.com'])
  })
})
