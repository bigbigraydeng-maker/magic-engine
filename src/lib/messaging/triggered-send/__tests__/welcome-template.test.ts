import { describe, expect, it } from 'vitest'
import type { EmailTemplateVersion } from '@/lib/crm/email-templates/types'
import { checkAutomatedTemplate, templateContentSha256 } from '../welcome-template'

function template(over: Partial<EmailTemplateVersion> = {}): EmailTemplateVersion {
  return {
    id: 't1',
    clientId: 'c0000000-0000-0000-0000-000000000000',
    templateKey: 'auto-welcome',
    version: 2,
    name: 'Welcome',
    subject: 'Welcome, {{ first_name }}',
    body: 'Hi {{first_name}},\nThanks for your enquiry.',
    factSource: 'none',
    pickMode: 'none',
    pickFilter: {},
    status: 'active',
    changeNote: null,
    createdBy: 'pm@example.com',
    createdAt: '2026-11-10T00:00:00.000Z',
    ...over,
  }
}

describe('checkAutomatedTemplate', () => {
  it('accepts an active auto- template that only greets by first name, and fingerprints its content', () => {
    const check = checkAutomatedTemplate(template())
    expect(check).toEqual({ ok: true, version: 2, sha256: templateContentSha256(template()) })
  })

  it('refuses everything the first version may not have', () => {
    const cases: Array<[EmailTemplateVersion | null, string]> = [
      [null, 'template_missing'],
      [template({ status: 'disabled' }), 'template_disabled'],
      [template({ templateKey: 'welcome' }), 'template_not_automated'],
      [template({ factSource: 'published_tours' }), 'template_uses_facts'],
      [template({ pickMode: 'one' }), 'template_picks'],
      [template({ body: 'Hi {{ first_name }}, from {{ sender_name }}' }), 'template_placeholder_not_allowed'],
      [template({ subject: 'Tours {{ tour.name:2 }}' }), 'template_placeholder_not_allowed'],
      [template({ body: 'Hi {{ first_name }}, {{ broken' }), 'template_placeholder_not_allowed'],
      [template({ body: 'Hi {{first_name:1}}' }), 'template_placeholder_not_allowed'],
    ]
    for (const [t, reason] of cases) expect(checkAutomatedTemplate(t), reason).toEqual({ ok: false, reason })
  })

  it('the fingerprint changes with the content, not with the name, note or author', () => {
    const base = templateContentSha256(template())
    expect(templateContentSha256(template({ body: 'Hi {{first_name}},\nThanks!' }))).not.toBe(base)
    expect(templateContentSha256(template({ subject: 'Welcome' }))).not.toBe(base)
    expect(templateContentSha256(template({ name: 'Renamed', changeNote: 'x', createdBy: 'someone@example.com', version: 9 }))).toBe(base)
  })

  it('an absent optional pick-filter field does not break the fingerprint', () => {
    expect(templateContentSha256(template({ pickFilter: { destinations: undefined } }))).toBe(templateContentSha256(template({ pickFilter: {} })))
  })
})
