import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canonicalJson, gatesOf, parseLetterRule, parseRule, parseSendRule, ruleSha256, WELCOME_GATES } from '../rule'
import { lettersFingerprint, MAX_LETTERS } from '../send-rule'
import { sendableRule } from './authorization-fakes'
import { entryFor, followupTemplate, letterRule, letterTemplate } from './letter-fakes'

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** A letter rule as plain JSON, to break on purpose. */
type RawLetterRule = Record<string, unknown> & { send: Record<string, unknown> & { letters: unknown[] } }
function rawLetterRule(): RawLetterRule {
  return JSON.parse(JSON.stringify(letterRule())) as RawLetterRule
}

describe('rule.gates — the switchable gates', () => {
  it('🔴 a welcome rule without gates keeps exactly its fingerprint (no gates key is ever written)', () => {
    const raw = clone(sendableRule())
    const parsed = parseRule(raw)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(Object.prototype.hasOwnProperty.call(parsed.rule, 'gates')).toBe(false)
    expect(canonicalJson(parsed.rule)).toBe(canonicalJson(raw))
    expect(ruleSha256(parsed.rule)).toBe(ruleSha256(sendableRule()))
  })

  it('absent gates = the welcome letter\'s gates', () => {
    expect(gatesOf(sendableRule())).toEqual({ sales_email: true, legacy_welcomed: true, stale: true, count_legacy_batch: false })
    expect(WELCOME_GATES).toEqual(gatesOf({}))
  })

  it('parses the four booleans strictly, and the gates are part of the fingerprint', () => {
    const gates = { sales_email: false, legacy_welcomed: false, stale: false, count_legacy_batch: true }
    const parsed = parseRule({ ...clone(sendableRule()), gates })
    expect(parsed).toMatchObject({ ok: true, rule: { gates } })
    if (parsed.ok) expect(ruleSha256(parsed.rule)).not.toBe(ruleSha256(sendableRule()))
    expect(parseRule({ ...clone(sendableRule()), gates: { ...gates, stale: 'no' } })).toEqual({ ok: false, error: 'gates.stale must be a boolean' })
    expect(parseRule({ ...clone(sendableRule()), gates: { sales_email: false } })).toMatchObject({ ok: false, error: 'gates.legacy_welcomed is required' })
    expect(parseRule({ ...clone(sendableRule()), gates: { ...gates, extra: true } })).toEqual({ ok: false, error: 'gates.extra is not allowed' })
  })
})

describe('send.letters — a list of letters', () => {
  it('parses a letter list and keeps it as written', () => {
    const rule = letterRule()
    expect(parseRule(clone(rule))).toEqual({ ok: true, rule })
    expect(parseLetterRule(clone(rule))).toEqual({ ok: true, rule })
  })

  it('🔴 template and letters are exclusive; a letter list is not a one-letter rule and the other way round', () => {
    const rule = rawLetterRule()
    rule.send.template = { key: 'auto-welcome' }
    expect(parseRule(rule)).toEqual({ ok: false, error: 'send.template and send.letters are exclusive' })
    expect(parseSendRule(clone(letterRule()))).toMatchObject({ ok: false })
    expect(parseLetterRule(clone(sendableRule()))).toMatchObject({ ok: false })
    // A list of letters without a gates block is refused: the welcome letter's gates would take the old batch out of the count.
    const noGates: Record<string, unknown> = rawLetterRule()
    delete noGates.gates
    expect(parseLetterRule(noGates)).toMatchObject({ ok: false, error: 'gates is required for a rule that sends a list of letters' })
  })

  it('🔴 1 to 8 letters, each key once', () => {
    const one = entryFor('catalogue_2027', letterTemplate())
    expect(parseRule(clone(letterRule({ letters: [] })))).toEqual({ ok: false, error: `send.letters must hold 1..${MAX_LETTERS} letters` })
    const eight = Array.from({ length: 8 }, (_, i) => ({ ...one, letter_key: `letter_${i}` }))
    expect(parseRule(clone(letterRule({ letters: eight })))).toMatchObject({ ok: true })
    const nine = Array.from({ length: 9 }, (_, i) => ({ ...one, letter_key: `letter_${i}` }))
    expect(parseRule(clone(letterRule({ letters: nine })))).toMatchObject({ ok: false })
    expect(parseRule(clone(letterRule({ letters: [one, one] })))).toEqual({ ok: false, error: 'send.letters has the letter_key catalogue_2027 twice' })
  })

  it('🔴 each letter: a well-formed key, an auto- template, a version >= 1, a 64-hex fingerprint, the context only', () => {
    const ok = entryFor('catalogue_2027', letterTemplate())
    const bad: Array<[Record<string, unknown>, string]> = [
      [{ ...ok, letter_key: 'Catalogue' }, 'send.letters[0].letter_key is malformed'],
      [{ ...ok, letter_key: 'x' }, 'send.letters[0].letter_key is malformed'],
      [{ ...ok, template_key: 'welcome-letter' }, 'send.letters[0].template_key must be an automated (auto-) template'],
      [{ ...ok, template_version: 0 }, 'send.letters[0].template_version must be an integer >= 1'],
      [{ ...ok, template_sha256: 'A'.repeat(64) }, 'send.letters[0].template_sha256 must be 64 lower-case hex characters'],
      [{ ...ok, extra: 1 }, 'send.letters[0].extra is not allowed'],
      [{ ...ok, context: { catalogue_url: 'http://x.example.com/c', catalogue_valid_until: null } }, 'send.letters[0].context.catalogue_url must be null or an https link'],
      [{ ...ok, context: { catalogue_url: null, catalogue_valid_until: '2027-02-30' } }, 'send.letters[0].context.catalogue_valid_until must be null or YYYY-MM-DD'],
      [{ ...ok, context: { catalogue_url: null } }, 'send.letters[0].context.catalogue_valid_until is required'],
      [{ ...ok, context: { catalogue_url: null, catalogue_valid_until: null, tour: 'x' } }, 'send.letters[0].context.tour is not allowed'],
    ]
    for (const [letter, error] of bad) {
      const rule = rawLetterRule()
      rule.send.letters = [letter]
      expect(parseRule(rule), error).toEqual({ ok: false, error })
    }
  })

  it('🔴 an empty audience is allowed only for a letter list', () => {
    expect(parseRule(clone(letterRule()))).toMatchObject({ ok: true })
    const welcome = clone(sendableRule())
    welcome.audience.sources = []
    expect(parseRule(welcome)).toEqual({ ok: false, error: 'audience.sources must be a non-empty array' })
  })
})

describe('lettersFingerprint', () => {
  it('is the sha256 of the letters sorted by key with only key and pinned template; order and context do not change it', () => {
    const a = entryFor('catalogue_2027', letterTemplate(), { catalogue_url: 'https://www.example.com/c' })
    const b = entryFor('followup_d7', followupTemplate())
    const fp = lettersFingerprint([a, b])
    expect(fp).toMatch(/^[0-9a-f]{64}$/)
    expect(lettersFingerprint([b, a])).toBe(fp)
    expect(lettersFingerprint([{ ...a, context: { catalogue_url: null, catalogue_valid_until: null } }, b])).toBe(fp)
    expect(lettersFingerprint([{ ...a, template_version: a.template_version + 1 }, b])).not.toBe(fp)
    const expected = canonicalJson([a, b].map((l) => ({ letter_key: l.letter_key, template_key: l.template_key, template_version: l.template_version, template_sha256: l.template_sha256 })))
    expect(fp).toBe(createHash('sha256').update(expected, 'utf8').digest('hex'))
  })
})
