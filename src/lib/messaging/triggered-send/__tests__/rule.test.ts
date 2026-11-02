import { describe, it, expect } from 'vitest'
import {
  parseRule,
  canonicalJson,
  ruleSha256,
  GATE_CONTRACT_VERSION,
  ALLOWED_AUDIENCE_SOURCES,
  type TriggeredSendRule,
} from '../rule'

function validFixture(): TriggeredSendRule {
  return {
    gate_contract_version: 1,
    audience: {
      sources: ['meta_lead_form'],
      max_age_days: 3,
      min_age: 'previous_local_day',
    },
    schedule: { timezone: 'Pacific/Auckland' },
    frequency_cap: { max: 2, window_days: 7 },
    consent: { accepted_bases: ['form_disclosure_attested'] },
    legacy: { mailchimp_campaign_title_prefix: 'legacy_batch_' },
    human_mail: { required_mailboxes: ['sales@example.com'] },
    recipient_allowlist: null,
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function expectReject(input: unknown): string {
  const result = parseRule(input)
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('expected rejection')
  expect(typeof result.error).toBe('string')
  expect(result.error.length).toBeGreaterThan(0)
  return result.error
}

describe('constants', () => {
  it('exposes the gate contract version', () => {
    expect(GATE_CONTRACT_VERSION).toBe(1)
  })

  it('exposes the allowed audience sources', () => {
    expect(ALLOWED_AUDIENCE_SOURCES).toEqual(['meta_lead_form', 'crm_manual'])
  })
})

describe('parseRule - happy path', () => {
  it('accepts the valid fixture and deep-equals the input', () => {
    const fixture = validFixture()
    const result = parseRule(fixture)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rule).toEqual(fixture)
  })

  it('returns a new object (not the same reference)', () => {
    const fixture = validFixture()
    const result = parseRule(fixture)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rule).not.toBe(fixture)
    expect(result.rule.audience).not.toBe(fixture.audience)
    expect(result.rule.audience.sources).not.toBe(fixture.audience.sources)
  })

  it('accepts crm_manual when a non-empty allowlist is present', () => {
    const fixture = validFixture()
    fixture.audience.sources = ['crm_manual']
    fixture.recipient_allowlist = ['ops@example.com']
    const result = parseRule(fixture)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rule.audience.sources).toEqual(['crm_manual'])
    expect(result.rule.recipient_allowlist).toEqual(['ops@example.com'])
  })

  it('accepts both sources together with an allowlist', () => {
    const fixture = validFixture()
    fixture.audience.sources = ['meta_lead_form', 'crm_manual']
    fixture.recipient_allowlist = ['ops@example.com']
    expect(parseRule(fixture).ok).toBe(true)
  })
})

describe('parseRule - top-level shape', () => {
  it('rejects a missing top-level key for each key', () => {
    const keys: Array<keyof TriggeredSendRule> = [
      'gate_contract_version',
      'audience',
      'schedule',
      'frequency_cap',
      'consent',
      'legacy',
      'human_mail',
      'recipient_allowlist',
    ]
    for (const key of keys) {
      const fixture = validFixture() as unknown as Record<string, unknown>
      delete fixture[key]
      expectReject(fixture)
    }
  })

  it('rejects an extra top-level key', () => {
    const fixture = validFixture() as unknown as Record<string, unknown>
    fixture.extra = true
    expectReject(fixture)
  })

  it('rejects an extra nested key in each nested object', () => {
    const mutations: Array<(f: Record<string, unknown>) => void> = [
      (f) => {
        ;(f.audience as Record<string, unknown>).extra = 1
      },
      (f) => {
        ;(f.schedule as Record<string, unknown>).extra = 1
      },
      (f) => {
        ;(f.frequency_cap as Record<string, unknown>).extra = 1
      },
      (f) => {
        ;(f.consent as Record<string, unknown>).extra = 1
      },
      (f) => {
        ;(f.legacy as Record<string, unknown>).extra = 1
      },
      (f) => {
        ;(f.human_mail as Record<string, unknown>).extra = 1
      },
    ]
    for (const mutate of mutations) {
      const fixture = validFixture() as unknown as Record<string, unknown>
      mutate(fixture)
      expectReject(fixture)
    }
  })

  it('rejects a missing nested key in each nested object', () => {
    const mutations: Array<(f: Record<string, unknown>) => void> = [
      (f) => {
        delete (f.audience as Record<string, unknown>).sources
      },
      (f) => {
        delete (f.schedule as Record<string, unknown>).timezone
      },
      (f) => {
        delete (f.frequency_cap as Record<string, unknown>).max
      },
      (f) => {
        delete (f.consent as Record<string, unknown>).accepted_bases
      },
      (f) => {
        delete (f.legacy as Record<string, unknown>).mailchimp_campaign_title_prefix
      },
      (f) => {
        delete (f.human_mail as Record<string, unknown>).required_mailboxes
      },
    ]
    for (const mutate of mutations) {
      const fixture = validFixture() as unknown as Record<string, unknown>
      mutate(fixture)
      expectReject(fixture)
    }
  })
})

describe('parseRule - gate_contract_version', () => {
  it('rejects 0', () => {
    const f = validFixture()
    f.gate_contract_version = 0
    expectReject(f)
  })

  it('rejects a non-integer', () => {
    const f = validFixture()
    f.gate_contract_version = 1.5
    expectReject(f)
  })

  it('rejects a string', () => {
    const f = validFixture() as unknown as Record<string, unknown>
    f.gate_contract_version = '1'
    expectReject(f)
  })

  it('accepts a higher version (no comparison with GATE_CONTRACT_VERSION)', () => {
    const f = validFixture()
    f.gate_contract_version = 99
    expect(parseRule(f).ok).toBe(true)
  })
})

describe('parseRule - audience.sources', () => {
  it('rejects an empty array', () => {
    const f = validFixture()
    f.audience.sources = []
    expectReject(f)
  })

  it('rejects an unknown source', () => {
    const f = validFixture()
    f.audience.sources = ['unknown_source']
    expectReject(f)
  })

  it('rejects duplicate sources', () => {
    const f = validFixture()
    f.audience.sources = ['meta_lead_form', 'meta_lead_form']
    expectReject(f)
  })

  it('rejects a non-array', () => {
    const f = validFixture() as unknown as Record<string, unknown>
    ;(f.audience as Record<string, unknown>).sources = 'meta_lead_form'
    expectReject(f)
  })

  it('rejects crm_manual without an allowlist', () => {
    const f = validFixture()
    f.audience.sources = ['crm_manual']
    f.recipient_allowlist = null
    expectReject(f)
  })
})

describe('parseRule - audience.max_age_days boundaries', () => {
  it('rejects 0', () => {
    const f = validFixture()
    f.audience.max_age_days = 0
    expectReject(f)
  })

  it('accepts 1', () => {
    const f = validFixture()
    f.audience.max_age_days = 1
    expect(parseRule(f).ok).toBe(true)
  })

  it('accepts 14', () => {
    const f = validFixture()
    f.audience.max_age_days = 14
    expect(parseRule(f).ok).toBe(true)
  })

  it('rejects 15', () => {
    const f = validFixture()
    f.audience.max_age_days = 15
    expectReject(f)
  })

  it('rejects a non-integer', () => {
    const f = validFixture()
    f.audience.max_age_days = 3.5
    expectReject(f)
  })
})

describe('parseRule - audience.min_age', () => {
  it('rejects any other value', () => {
    const f = validFixture() as unknown as Record<string, unknown>
    ;(f.audience as Record<string, unknown>).min_age = 'same_day'
    expectReject(f)
  })
})

describe('parseRule - schedule.timezone', () => {
  it('accepts Pacific/Auckland', () => {
    const f = validFixture()
    f.schedule.timezone = 'Pacific/Auckland'
    expect(parseRule(f).ok).toBe(true)
  })

  it('rejects lower-case pacific/auckland', () => {
    const f = validFixture()
    f.schedule.timezone = 'pacific/auckland'
    expectReject(f)
  })

  it('rejects an unknown zone', () => {
    const f = validFixture()
    f.schedule.timezone = 'Mars/Olympus'
    expectReject(f)
  })

  it('rejects a non-string', () => {
    const f = validFixture() as unknown as Record<string, unknown>
    ;(f.schedule as Record<string, unknown>).timezone = 42
    expectReject(f)
  })
})

describe('parseRule - frequency_cap.max boundaries', () => {
  it('rejects 0', () => {
    const f = validFixture()
    f.frequency_cap.max = 0
    expectReject(f)
  })

  it('accepts 1', () => {
    const f = validFixture()
    f.frequency_cap.max = 1
    expect(parseRule(f).ok).toBe(true)
  })

  it('accepts 5', () => {
    const f = validFixture()
    f.frequency_cap.max = 5
    expect(parseRule(f).ok).toBe(true)
  })

  it('rejects 6', () => {
    const f = validFixture()
    f.frequency_cap.max = 6
    expectReject(f)
  })
})

describe('parseRule - frequency_cap.window_days boundaries', () => {
  it('rejects 0', () => {
    const f = validFixture()
    f.frequency_cap.window_days = 0
    expectReject(f)
  })

  it('accepts 1', () => {
    const f = validFixture()
    f.frequency_cap.window_days = 1
    expect(parseRule(f).ok).toBe(true)
  })

  it('accepts 30', () => {
    const f = validFixture()
    f.frequency_cap.window_days = 30
    expect(parseRule(f).ok).toBe(true)
  })

  it('rejects 31', () => {
    const f = validFixture()
    f.frequency_cap.window_days = 31
    expectReject(f)
  })
})

describe('parseRule - consent.accepted_bases', () => {
  it('rejects an empty array', () => {
    const f = validFixture()
    f.consent.accepted_bases = []
    expectReject(f)
  })

  it('rejects duplicates', () => {
    const f = validFixture()
    f.consent.accepted_bases = ['a', 'a']
    expectReject(f)
  })

  it('rejects an empty string entry', () => {
    const f = validFixture()
    f.consent.accepted_bases = ['']
    expectReject(f)
  })

  it('rejects an entry longer than 80 chars', () => {
    const f = validFixture()
    f.consent.accepted_bases = ['x'.repeat(81)]
    expectReject(f)
  })

  it('accepts an entry of exactly 80 chars', () => {
    const f = validFixture()
    f.consent.accepted_bases = ['x'.repeat(80)]
    expect(parseRule(f).ok).toBe(true)
  })
})

describe('parseRule - legacy.mailchimp_campaign_title_prefix', () => {
  it('rejects an empty string', () => {
    const f = validFixture()
    f.legacy.mailchimp_campaign_title_prefix = ''
    expectReject(f)
  })

  it('rejects a string longer than 80 chars', () => {
    const f = validFixture()
    f.legacy.mailchimp_campaign_title_prefix = 'x'.repeat(81)
    expectReject(f)
  })

  it('rejects a non-string', () => {
    const f = validFixture() as unknown as Record<string, unknown>
    ;(f.legacy as Record<string, unknown>).mailchimp_campaign_title_prefix = 1
    expectReject(f)
  })
})

describe('parseRule - human_mail.required_mailboxes', () => {
  it('rejects an empty array', () => {
    const f = validFixture()
    f.human_mail.required_mailboxes = []
    expectReject(f)
  })

  it('rejects an upper-case e-mail', () => {
    const f = validFixture()
    f.human_mail.required_mailboxes = ['Sales@example.com']
    expectReject(f)
  })

  it('rejects a malformed e-mail', () => {
    const f = validFixture()
    f.human_mail.required_mailboxes = ['not-an-email']
    expectReject(f)
  })

  it('rejects duplicates', () => {
    const f = validFixture()
    f.human_mail.required_mailboxes = ['a@example.com', 'a@example.com']
    expectReject(f)
  })
})

describe('parseRule - recipient_allowlist', () => {
  it('accepts null', () => {
    const f = validFixture()
    f.recipient_allowlist = null
    expect(parseRule(f).ok).toBe(true)
  })

  it('rejects an empty array', () => {
    const f = validFixture()
    f.recipient_allowlist = []
    expectReject(f)
  })

  it('rejects an upper-case e-mail', () => {
    const f = validFixture()
    f.recipient_allowlist = ['Ops@example.com']
    expectReject(f)
  })

  it('rejects duplicates', () => {
    const f = validFixture()
    f.recipient_allowlist = ['a@example.com', 'a@example.com']
    expectReject(f)
  })

  it('rejects a non-array non-null value', () => {
    const f = validFixture() as unknown as Record<string, unknown>
    f.recipient_allowlist = 'a@example.com'
    expectReject(f)
  })
})

describe('parseRule - never throws', () => {
  const inputs: unknown[] = [undefined, null, 5, 'x', [], {}]
  for (const input of inputs) {
    it(`returns ok:false for ${JSON.stringify(input) ?? String(input)}`, () => {
      let result: ReturnType<typeof parseRule> | undefined
      expect(() => {
        result = parseRule(input)
      }).not.toThrow()
      expect(result?.ok).toBe(false)
    })
  }
})

describe('canonicalJson', () => {
  it('matches the known vector', () => {
    const value = { b: 1, a: [2, { d: 1, c: 2 }], e: null }
    expect(canonicalJson(value)).toBe('{"a":[2,{"c":2,"d":1}],"b":1,"e":null}')
  })

  it('is independent of key insertion order', () => {
    const a = { z: 1, a: { y: 2, b: 3 }, m: [1, 2, 3] }
    const b = { m: [1, 2, 3], a: { b: 3, y: 2 }, z: 1 }
    expect(canonicalJson(a)).toBe(canonicalJson(b))
  })

  it('preserves array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]')
  })

  it('encodes primitives like JSON.stringify', () => {
    expect(canonicalJson('a"b')).toBe(JSON.stringify('a"b'))
    expect(canonicalJson(true)).toBe('true')
    expect(canonicalJson(false)).toBe('false')
    expect(canonicalJson(null)).toBe('null')
    expect(canonicalJson(1.5)).toBe('1.5')
  })

  it('throws for undefined', () => {
    expect(() => canonicalJson(undefined)).toThrow()
  })

  it('throws for NaN', () => {
    expect(() => canonicalJson(NaN)).toThrow()
  })

  it('throws for Infinity', () => {
    expect(() => canonicalJson(Infinity)).toThrow()
  })

  it('throws for a Date', () => {
    expect(() => canonicalJson(new Date())).toThrow()
  })

  it('throws for a function', () => {
    expect(() => canonicalJson(() => 1)).toThrow()
  })

  it('throws for a Map', () => {
    expect(() => canonicalJson(new Map())).toThrow()
  })

  it('throws for a bigint', () => {
    expect(() => canonicalJson(BigInt(1))).toThrow()
  })

  it('throws for a symbol', () => {
    expect(() => canonicalJson(Symbol('x'))).toThrow()
  })
})

describe('ruleSha256', () => {
  it('matches the known vector hash', () => {
    const value = { b: 1, a: [2, { d: 1, c: 2 }], e: null }
    const hash = ruleSha256(value as unknown as TriggeredSendRule)
    expect(hash).toBe('1db8339a41b7c9733ce25f67e54e9ed51f665e90028d2e2de921f6c08fb3aba4')
  })

  it('is 64 lower-case hex characters', () => {
    const hash = ruleSha256(validFixture())
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is identical for objects whose keys were inserted in a different order', () => {
    const a = validFixture()
    const b: TriggeredSendRule = {
      recipient_allowlist: a.recipient_allowlist,
      human_mail: a.human_mail,
      legacy: a.legacy,
      consent: a.consent,
      frequency_cap: a.frequency_cap,
      schedule: a.schedule,
      audience: a.audience,
      gate_contract_version: a.gate_contract_version,
    }
    expect(ruleSha256(a)).toBe(ruleSha256(b))
  })

  it('changes when any single leaf value changes', () => {
    const base = validFixture()
    const baseHash = ruleSha256(base)

    const mutations: Array<(r: TriggeredSendRule) => void> = [
      (r) => {
        r.gate_contract_version = 2
      },
      (r) => {
        r.audience.sources = ['crm_manual']
        r.recipient_allowlist = ['ops@example.com']
      },
      (r) => {
        r.audience.max_age_days = 4
      },
      (r) => {
        r.schedule.timezone = 'Europe/Berlin'
      },
      (r) => {
        r.frequency_cap.max = 3
      },
      (r) => {
        r.frequency_cap.window_days = 8
      },
      (r) => {
        r.consent.accepted_bases = ['other_basis']
      },
      (r) => {
        r.legacy.mailchimp_campaign_title_prefix = 'other_prefix_'
      },
      (r) => {
        r.human_mail.required_mailboxes = ['other@example.com']
      },
      (r) => {
        r.recipient_allowlist = ['ops@example.com']
      },
    ]

    for (const mutate of mutations) {
      const copy = clone(base)
      mutate(copy)
      expect(ruleSha256(copy)).not.toBe(baseHash)
    }
  })
})
