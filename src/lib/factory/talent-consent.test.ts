import { describe, expect, it } from 'vitest'
import {
  CONSENT_REASON_ZH,
  consentVerdict,
  identifiableFaceCount,
  readTalentConsent,
  type ConsentBlockReason,
} from './talent-consent'

const GRANTED = {
  status: 'granted',
  scope: ['facebook_organic'],
  subject: 'tour guest',
  confirmed_by: 'system:pm-chat',
  confirmed_at: '2026-11-04T00:00:00.000Z',
  evidence: 'PM confirmed in chat 2026-11-04',
}

const ext = (consent?: unknown) => ({
  engine: 'external_upload',
  ...(consent === undefined ? {} : { talent_consent: consent }),
})

const v2 = (faces: number, status = 'pass') => ({
  maliang_check: {
    check_version: 'v2',
    status,
    identifiable_faces: faces > 0 ? [{ t_start: 0, t_end: 2, count: faces }] : [],
  },
})

describe('consentVerdict', () => {
  it('1. external, no consent → consent_missing', () => {
    expect(consentVerdict({ brief: ext(), output: v2(0), use: 'facebook_organic' })).toEqual({
      ok: false,
      reason: 'consent_missing',
    })
  })

  it('2. external, granted, no maliang → faces_unchecked', () => {
    expect(consentVerdict({ brief: ext(GRANTED), output: {}, use: 'facebook_organic' })).toEqual({
      ok: false,
      reason: 'faces_unchecked',
    })
  })

  it('3. external, granted, v2 unverifiable → faces_unchecked', () => {
    expect(
      consentVerdict({ brief: ext(GRANTED), output: v2(0, 'unverifiable'), use: 'facebook_organic' }),
    ).toEqual({ ok: false, reason: 'faces_unchecked' })
  })

  it('4. external, granted, v2 pass with 0 faces → ok', () => {
    expect(consentVerdict({ brief: ext(GRANTED), output: v2(0), use: 'facebook_organic' })).toEqual({
      ok: true,
    })
  })

  it('5. external, granted, v2 pass 2 faces → ok', () => {
    expect(consentVerdict({ brief: ext(GRANTED), output: v2(2), use: 'facebook_organic' })).toEqual({
      ok: true,
    })
  })

  it('6. external, granted scope meta_ads only, v2 pass 1 face, use facebook_organic → consent_scope', () => {
    const consent = { ...GRANTED, scope: ['meta_ads'] }
    expect(consentVerdict({ brief: ext(consent), output: v2(1), use: 'facebook_organic' })).toEqual({
      ok: false,
      reason: 'consent_scope',
    })
  })

  it('7. external, not_needed (scope []), v2 pass 1 face → consent_conflict', () => {
    const consent = { ...GRANTED, status: 'not_needed', scope: [] }
    expect(consentVerdict({ brief: ext(consent), output: v2(1), use: 'facebook_organic' })).toEqual({
      ok: false,
      reason: 'consent_conflict',
    })
  })

  it('8. external, not_needed, v2 pass 0 faces → ok', () => {
    const consent = { ...GRANTED, status: 'not_needed', scope: [] }
    expect(consentVerdict({ brief: ext(consent), output: v2(0), use: 'facebook_organic' })).toEqual({
      ok: true,
    })
  })

  it('9. factory brief {} with no maliang → ok (known gap)', () => {
    expect(consentVerdict({ brief: {}, output: {}, use: 'facebook_organic' })).toEqual({ ok: true })
  })

  it('10. factory brief {}, v2 pass 1 face, no consent → ok (factory videos not gated yet, known gap)', () => {
    expect(consentVerdict({ brief: {}, output: v2(1), use: 'facebook_organic' })).toEqual({ ok: true })
  })

  it('10b. external, consent scoped to ads only, v2 pass 0 faces, use facebook_organic → consent_scope', () => {
    const consent = { ...GRANTED, scope: ['meta_ads'] }
    expect(consentVerdict({ brief: ext(consent), output: v2(0), use: 'facebook_organic' })).toEqual({
      ok: false,
      reason: 'consent_scope',
    })
  })

  it('10c. external, Facebook-only consent cannot be used for TikTok', () => {
    expect(consentVerdict({ brief: ext(GRANTED), output: v2(1), use: 'tiktok_organic' })).toEqual({
      ok: false,
      reason: 'consent_scope',
    })
  })

  it('11. factory brief with GRANTED, v1 maliang → ok', () => {
    const output = { maliang_check: { status: 'pass' } }
    expect(consentVerdict({ brief: { talent_consent: GRANTED }, output, use: 'facebook_organic' })).toEqual({
      ok: true,
    })
  })

  it('12a. invalid consent: missing evidence → consent_invalid', () => {
    const { evidence: _evidence, ...rest } = GRANTED
    void _evidence
    expect(consentVerdict({ brief: ext(rest), output: v2(0), use: 'facebook_organic' })).toEqual({
      ok: false,
      reason: 'consent_invalid',
    })
  })

  it('12b. invalid consent: status yes → consent_invalid', () => {
    const consent = { ...GRANTED, status: 'yes' }
    expect(consentVerdict({ brief: ext(consent), output: v2(0), use: 'facebook_organic' })).toEqual({
      ok: false,
      reason: 'consent_invalid',
    })
  })

  it('12c. invalid consent: confirmed_at nope → consent_invalid', () => {
    const consent = { ...GRANTED, confirmed_at: 'nope' }
    expect(consentVerdict({ brief: ext(consent), output: v2(0), use: 'facebook_organic' })).toEqual({
      ok: false,
      reason: 'consent_invalid',
    })
  })

  it('12d. invalid consent: granted with scope [] → consent_invalid', () => {
    const consent = { ...GRANTED, scope: [] }
    expect(consentVerdict({ brief: ext(consent), output: v2(0), use: 'facebook_organic' })).toEqual({
      ok: false,
      reason: 'consent_invalid',
    })
  })
})

describe('identifiableFaceCount', () => {
  it('13a. v1 → null', () => {
    expect(identifiableFaceCount({ maliang_check: { status: 'pass' } })).toBeNull()
  })

  it('13b. v2 with malformed entry → null', () => {
    const output = {
      maliang_check: {
        check_version: 'v2',
        status: 'pass',
        identifiable_faces: [{ count: 'x' }],
      },
    }
    expect(identifiableFaceCount(output)).toBeNull()
  })

  it('13c. v2 two entries counts 1 and 2 → 3', () => {
    const output = {
      maliang_check: {
        check_version: 'v2',
        status: 'pass',
        identifiable_faces: [
          { t_start: 0, t_end: 1, count: 1 },
          { t_start: 1, t_end: 2, count: 2 },
        ],
      },
    }
    expect(identifiableFaceCount(output)).toBe(3)
  })
})

describe('readTalentConsent', () => {
  it('14. dedupes scope and ignores extra fields', () => {
    const raw = {
      ...GRANTED,
      scope: ['facebook_organic', 'facebook_organic'],
      extra: 'ignored',
    }
    const result = readTalentConsent({ talent_consent: raw })
    expect(result).not.toBeNull()
    expect(result).not.toBe('invalid')
    if (result === null || result === 'invalid') return
    expect(result.scope).toEqual(['facebook_organic'])
    expect(Object.keys(result).sort()).toEqual(
      ['confirmed_at', 'confirmed_by', 'evidence', 'scope', 'status', 'subject'].sort(),
    )
  })
})

describe('CONSENT_REASON_ZH', () => {
  it('15. every ConsentBlockReason has a non-empty label', () => {
    const reasons: ConsentBlockReason[] = [
      'consent_missing',
      'consent_invalid',
      'consent_scope',
      'faces_unchecked',
      'face_consent_missing',
      'consent_conflict',
    ]
    for (const reason of reasons) {
      const label = CONSENT_REASON_ZH[reason]
      expect(typeof label).toBe('string')
      expect(label.trim().length).toBeGreaterThan(0)
    }
  })
})
