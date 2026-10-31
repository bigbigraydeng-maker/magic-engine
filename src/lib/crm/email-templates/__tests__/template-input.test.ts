import { describe, expect, it } from 'vitest'
import { checkTemplateForSave, parseTemplateWrite, statusForAppend } from '@/lib/crm/email-templates/template-input'
import { settingsObj } from './fixtures'

const fields = {
  name: 'Post-call single tour',
  subject: '{{tour_name}}: your itinerary',
  body: 'Kia ora {{first_name}},\n\n{{tour_name}} departs {{departure_date}}.\n\n{{tour_url}}\n\n{{sender_name}}',
  factSource: 'published_tours',
  pickMode: 'one',
  pickFilter: { destinations: ['china'], departureMonths: [3, 5] },
  status: 'active',
  changeNote: 'first draft',
}

describe('parseTemplateWrite: create', () => {
  it('accepts a complete new template and starts it at no base version', () => {
    const res = parseTemplateWrite({ ...fields, templateKey: 'post-call-single-tour' }, 'create')
    expect(res).toEqual({
      ok: true,
      templateKey: 'post-call-single-tour',
      baseVersion: null,
      fields: { ...fields, pickFilter: { destinations: ['china'], departureMonths: [3, 5] } },
    })
  })

  it('a new template is disabled unless it says otherwise', () => {
    const { status: _status, ...rest } = fields
    const res = parseTemplateWrite({ ...rest, templateKey: 'new-one' }, 'create')
    expect(res.ok && res.fields.status).toBe('disabled')
  })

  it.each([
    ['no key', { ...fields }],
    ['a bad key', { ...fields, templateKey: 'Bad Key' }],
    ['a base version (that is for edits)', { ...fields, templateKey: 'new-one', baseVersion: 1 }],
  ])('rejects %s', (_name, input) => {
    expect(parseTemplateWrite(input, 'create').ok).toBe(false)
  })
})

describe('parseTemplateWrite: update', () => {
  it('needs the version being edited and an explicit status', () => {
    const ok = parseTemplateWrite({ ...fields, baseVersion: 3 }, 'update')
    expect(ok.ok && ok.baseVersion).toBe(3)
    expect(ok.ok && ok.templateKey).toBeNull()
    const { status: _status, ...noStatus } = fields
    expect(parseTemplateWrite({ ...noStatus, baseVersion: 3 }, 'update').ok).toBe(false)
  })

  it.each([
    ['no base version', { ...fields }],
    ['base version 0', { ...fields, baseVersion: 0 }],
    ['a fractional base version', { ...fields, baseVersion: 1.5 }],
    ['a key in the body (it comes from the address)', { ...fields, baseVersion: 1, templateKey: 'other' }],
  ])('rejects %s', (_name, input) => {
    expect(parseTemplateWrite(input, 'update').ok).toBe(false)
  })
})

describe('parseTemplateWrite: fields', () => {
  const create = (over: Record<string, unknown>) => parseTemplateWrite({ ...fields, templateKey: 'k-1', ...over }, 'create')

  it.each([
    ['not an object', 'x'],
    ['an array', []],
  ])('rejects a body that is %s', (_name, input) => {
    expect(parseTemplateWrite(input, 'create').ok).toBe(false)
  })

  it.each([
    ['an unknown field', { extra: 1 }],
    ['a numeric name', { name: 5 }],
    ['a numeric subject', { subject: 5 }],
    ['a missing body', { body: undefined }],
    ['an unknown fact source', { factSource: 'crystal_ball' }],
    ['an unknown pick mode', { pickMode: 'all' }],
    ['an unknown status', { status: 'archived' }],
    ['a numeric change note', { changeNote: 5 }],
    ['a filter that is not an object', { pickFilter: 'china' }],
    ['a filter with an unknown key', { pickFilter: { colour: ['red'] } }],
    ['a filter with a non-list', { pickFilter: { tiers: 'signature' } }],
    ['a filter with an empty entry', { pickFilter: { destinations: [' '] } }],
    ['a filter with a too-long entry', { pickFilter: { destinations: ['x'.repeat(41)] } }],
    ['a filter with too many entries', { pickFilter: { tiers: Array.from({ length: 31 }, (_, i) => `t${i}`) } }],
    ['a month of 13', { pickFilter: { departureMonths: [13] } }],
    ['a fractional month', { pickFilter: { departureMonths: [2.5] } }],
  ])('rejects %s', (_name, over) => {
    expect(create(over).ok).toBe(false)
  })

  it('no filter means no restriction, and a null change note is kept as none', () => {
    const res = create({ pickFilter: undefined, changeNote: null })
    expect(res.ok && res.fields.pickFilter).toEqual({})
    expect(res.ok && res.fields.changeNote).toBeNull()
  })
})

describe('checkTemplateForSave', () => {
  const base = { subject: fields.subject, body: fields.body, factSource: 'published_tours' as const, pickMode: 'one' as const }
  const guard = settingsObj()

  it('passes a clean template', () => {
    expect(checkTemplateForSave(base, guard)).toEqual({ errors: [], notices: [] })
  })

  it('rejects an unknown variable and says where', () => {
    const res = checkTemplateForSave({ ...base, body: 'Hi {{no_such_thing}}' }, guard)
    expect(res.errors.some((e) => e.startsWith('正文：'))).toBe(true)
  })

  it('rejects a multi-line variable in the subject', () => {
    const res = checkTemplateForSave({ ...base, subject: 'Highlights: {{tour_highlights}}' }, guard)
    expect(res.errors.some((e) => e.startsWith('主题：'))).toBe(true)
  })

  it('rejects a variable that needs a tour when the template picks none', () => {
    const res = checkTemplateForSave({ ...base, pickMode: 'none' }, guard)
    expect(res.errors.length).toBeGreaterThan(0)
  })

  it('rejects a hand-written phrase that is on the blocklist, naming the rule', () => {
    const res = checkTemplateForSave({ ...base, body: `${base.body}\n\nOur tours are visa-free.` }, guard)
    expect(res.errors.join('|')).toContain('no-visa-free')
  })

  it('rejects a hand-written link to a host that is not allowed', () => {
    const res = checkTemplateForSave({ ...base, body: `${base.body}\n\nSee https://evil.example/deal` }, guard)
    expect(res.errors.join('|')).toContain('link_host_not_allowed')
  })

  it('accepts a hand-written link to an allowed host', () => {
    const res = checkTemplateForSave({ ...base, body: `${base.body}\n\nSee https://www.example.com/tours` }, guard)
    expect(res.errors).toEqual([])
  })

  it('does not mistake placeholders for leftover markers or links', () => {
    const res = checkTemplateForSave({ ...base, body: '{{tour_url}} {{all_tours_url}} {{first_name}}' }, { guardrails: { allowedLinkHosts: [], rules: [] } })
    expect(res.errors).toEqual([])
  })

  it('rejects leftover internal markers typed by hand', () => {
    const res = checkTemplateForSave({ ...base, body: `${base.body}\n(TBC)` }, guard)
    expect(res.errors.join('|')).toContain('placeholder_left')
  })

  it('turns warn-only phrases into notices, not errors', () => {
    const res = checkTemplateForSave({ ...base, body: `${base.body}\n\nGive me a call.` }, guard)
    expect(res.errors).toEqual([])
    expect(res.notices.join('|')).toContain('no calls')
  })

  it('without settings it still checks placeholders, and says the red lines were not checked', () => {
    const ok = checkTemplateForSave(base, null)
    expect(ok.errors).toEqual([])
    expect(ok.notices.join('|')).toContain('没有检查')
    const bad = checkTemplateForSave({ ...base, body: 'Hi {{no_such_thing}}' }, null)
    expect(bad.errors.length).toBeGreaterThan(0)
  })

  it('a template with no fact source cannot use tour variables', () => {
    const res = checkTemplateForSave({ ...base, factSource: 'none', pickMode: 'none' }, guard)
    expect(res.errors.length).toBeGreaterThan(0)
    const plain = checkTemplateForSave({ subject: 'Hello', body: 'Hi {{first_name}}', factSource: 'none', pickMode: 'none' }, guard)
    expect(plain.errors).toEqual([])
  })
})

describe('statusForAppend', () => {
  it('maps store failures to HTTP statuses', () => {
    expect(statusForAppend('conflict')).toBe(409)
    expect(statusForAppend('invalid')).toBe(400)
    expect(statusForAppend('error')).toBe(503)
  })
})
