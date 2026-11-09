import { describe, expect, it } from 'vitest'
import { renderTemplate, type RenderContext } from '@/lib/crm/email-templates/render'
import type {
  FactProvider,
  ProviderValue,
  RenderFacts,
  VariableSpec,
} from '@/lib/crm/email-templates/facts/types'
import type { EmailTemplateVersion } from '@/lib/crm/email-templates/types'

const TOUR_NAME = 'Milford Sound Overnight'
const TOUR_PRICE = "$1,999 $& $'"
const TOUR_HIGHLIGHTS = '- Fiord cruise\n- Kayak at dawn'

const variables: Record<string, VariableSpec> = {
  tour_name: { pickModes: ['one'], list: false, multiline: false },
  tour_price: { pickModes: ['one'], list: false, multiline: false },
  tour_highlights: { pickModes: ['one'], list: true, multiline: true },
}

const stubProvider: FactProvider = {
  id: 'published_tours',
  variables,
  resolve(name: string, _count: number | null, facts: RenderFacts): ProviderValue {
    if (facts === null) return { ok: false, missing: name }
    if (name === 'tour_name') return { ok: true, value: TOUR_NAME }
    if (name === 'tour_price') return { ok: true, value: TOUR_PRICE }
    if (name === 'tour_highlights') return { ok: true, value: TOUR_HIGHLIGHTS }
    return { ok: false, missing: name }
  },
  resolvePicks() {
    return { ok: true, picks: [] }
  },
  listPickOptions() {
    return []
  },
  checkLinks() {
    return []
  },
  knownAmounts() {
    return []
  },
  sellable() {
    return { ok: true }
  },
}

const emptyFacts: RenderFacts = { tours: [], picks: [], settings: null }

function baseCtx(overrides: Partial<RenderContext> = {}): RenderContext {
  return {
    contactName: 'Lisa',
    senderDisplayName: 'Aroha',
    callWhen: 'today',
    inputs: {},
    facts: emptyFacts,
    provider: stubProvider,
    ...overrides,
  }
}

const lisaTemplate: Pick<EmailTemplateVersion, 'subject' | 'body' | 'pickMode'> = {
  subject: '{{tour_name}}: your itinerary and price',
  body: [
    'Kia ora {{first_name}},',
    '',
    'Thank you for talking with me {{call_when}}.',
    '',
    '{{tour_highlights}}',
    '',
    'Price: {{tour_price}}',
    '',
    '{{sender_name}}',
  ].join('\n'),
  pickMode: 'one',
}

describe('renderTemplate', () => {
  it('renders a full Lisa-style template with no missing or problems', () => {
    const result = renderTemplate(lisaTemplate, baseCtx())
    expect(result.missing).toEqual([])
    expect(result.problems).toEqual([])
    expect(result.subject).toBe(`${TOUR_NAME}: your itinerary and price`)
    expect(result.body).toContain('Kia ora Lisa,')
    expect(result.body).toContain('Thank you for talking with me today.')
    expect(result.body).toContain(TOUR_HIGHLIGHTS)
    expect(result.body).toContain(`Price: ${TOUR_PRICE}`)
    expect(result.body).toContain('Aroha')
  })

  it('reports missing first_name when contactName is "Guest"', () => {
    const result = renderTemplate(lisaTemplate, baseCtx({ contactName: 'Guest' }))
    expect(result.missing).toContain('first_name')
  })

  it('reports missing call_when when callWhen is null', () => {
    const result = renderTemplate(lisaTemplate, baseCtx({ callWhen: null }))
    expect(result.missing).toContain('call_when')
  })

  it('resolves input.note when present', () => {
    const template = { subject: 'Hi', body: 'Note: {{input.note}}', pickMode: 'none' as const }
    const result = renderTemplate(template, baseCtx({ inputs: { note: '  hello  ' } }))
    expect(result.missing).toEqual([])
    expect(result.body).toBe('Note: hello')
  })

  it('reports missing input.note when blank', () => {
    const template = { subject: 'Hi', body: 'Note: {{input.note}}', pickMode: 'none' as const }
    const result = renderTemplate(template, baseCtx({ inputs: { note: '   ' } }))
    expect(result.missing).toContain('input.note')
  })

  it('reports missing input.note when absent', () => {
    const template = { subject: 'Hi', body: 'Note: {{input.note}}', pickMode: 'none' as const }
    const result = renderTemplate(template, baseCtx())
    expect(result.missing).toContain('input.note')
  })

  it('reports missing provider variable when facts is null', () => {
    const result = renderTemplate(lisaTemplate, baseCtx({ facts: null }))
    expect(result.missing).toContain('tour_name')
    expect(result.missing).toContain('tour_price')
    expect(result.missing).toContain('tour_highlights')
  })

  it('reports missing provider variable when no provider is set', () => {
    const result = renderTemplate(lisaTemplate, baseCtx({ provider: null }))
    expect(result.missing).toContain('tour_name')
    expect(result.missing).toContain('tour_price')
    expect(result.missing).toContain('tour_highlights')
  })

  it('leaves $ characters in values untouched', () => {
    const result = renderTemplate(lisaTemplate, baseCtx())
    expect(result.body).toContain(TOUR_PRICE)
  })

  it('flags placeholder_left when a value contains "{{first_name}}"', () => {
    const template = { subject: 'Hi', body: '{{input.note}}', pickMode: 'none' as const }
    const result = renderTemplate(
      template,
      baseCtx({ inputs: { note: 'see {{first_name}}' } }),
    )
    expect(result.problems).toContain('placeholder_left')
    expect(result.body).not.toContain('Lisa')
  })

  it('collapses newlines in the subject', () => {
    const template = { subject: 'Hello\n\n  world', body: 'body', pickMode: 'none' as const }
    const result = renderTemplate(template, baseCtx())
    expect(result.subject).toBe('Hello world')
  })

  it('flags subject_too_long for a 201-char result', () => {
    const template = { subject: 'x'.repeat(201), body: 'body', pickMode: 'none' as const }
    const result = renderTemplate(template, baseCtx())
    expect(result.problems).toContain('subject_too_long')
  })

  it('de-duplicates missing labels', () => {
    const template = {
      subject: '{{first_name}}',
      body: '{{first_name}} and {{first_name}}',
      pickMode: 'none' as const,
    }
    const result = renderTemplate(template, baseCtx({ contactName: 'Guest' }))
    expect(result.missing.filter((m) => m === 'first_name')).toHaveLength(1)
  })

  it('returns unique usedVariables', () => {
    const template = {
      subject: '{{first_name}}',
      body: '{{first_name}} {{sender_name}}',
      pickMode: 'none' as const,
    }
    const result = renderTemplate(template, baseCtx())
    expect(result.usedVariables).toEqual(['first_name', 'sender_name'])
  })

  it('trims body whitespace via sanitizeBody', () => {
    const template = { subject: 'Hi', body: '\n\n  hello  \n\n', pickMode: 'none' as const }
    const result = renderTemplate(template, baseCtx())
    expect(result.body).toBe('hello')
  })

  it('flags body_invalid when the rendered body is empty', () => {
    const template = { subject: 'Hi', body: '   ', pickMode: 'none' as const }
    const result = renderTemplate(template, baseCtx())
    expect(result.problems).toContain('body_invalid')
  })
})
