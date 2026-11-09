import { describe, expect, it } from 'vitest'
import { evaluateFollowUp } from '@/lib/crm/email-templates/gates/follow-up'
import type { StoredReceipt } from '@/lib/crm/email-templates/types'

const TEMPLATE = 'post-call-single-tour'
const OTHER_TEMPLATE = 'post-call-multi-tour'

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString()
}

function receipt(overrides: Partial<StoredReceipt> = {}): StoredReceipt {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    clientId: '22222222-2222-4222-8222-222222222222',
    contactId: '33333333-3333-4333-8333-333333333333',
    requestId: '44444444-4444-4444-8444-444444444444',
    actorEmail: 'staff@example.com',
    templateKey: TEMPLATE,
    templateVersion: 1,
    catalogVersion: null,
    callBasis: 'none',
    outcome: 'sent',
    blockReason: null,
    blockDetail: null,
    mailbox: null,
    conversationId: null,
    providerMessageId: null,
    editedAfterRender: null,
    warnings: [],
    renderedSha256: null,
    finalSha256: null,
    authBasis: 'human_click',
    createdAt: isoAgo(60 * 60 * 1000),
    ...overrides,
  }
}

const HOUR = 60 * 60 * 1000

describe('evaluateFollowUp', () => {
  it('never blocks a free-compose send (templateKey null)', () => {
    const result = evaluateFollowUp({
      templateKey: null,
      callEvidenceAt: isoAgo(2 * HOUR),
      cooldownHours: 24,
      now: new Date(),
      sentTemplateReceipts: [receipt({ createdAt: isoAgo(HOUR) })],
    })
    expect(result).toBeNull()
  })

  it('returns null when there are no receipts', () => {
    const result = evaluateFollowUp({
      templateKey: TEMPLATE,
      callEvidenceAt: null,
      cooldownHours: 24,
      now: new Date(),
      sentTemplateReceipts: [],
    })
    expect(result).toBeNull()
  })

  it('flags already_followed_up when a receipt was sent after the call evidence', () => {
    const result = evaluateFollowUp({
      templateKey: TEMPLATE,
      callEvidenceAt: isoAgo(2 * HOUR),
      cooldownHours: 0,
      now: new Date(),
      sentTemplateReceipts: [receipt({ createdAt: isoAgo(HOUR) })],
    })
    expect(result?.code).toBe('already_followed_up')
  })

  it('ignores receipts sent before the call evidence for the already_followed_up rule', () => {
    const result = evaluateFollowUp({
      templateKey: TEMPLATE,
      callEvidenceAt: isoAgo(HOUR),
      cooldownHours: 0,
      now: new Date(),
      sentTemplateReceipts: [receipt({ createdAt: isoAgo(2 * HOUR) })],
    })
    expect(result).toBeNull()
  })

  it('does not apply the already_followed_up rule when there is no call evidence', () => {
    const result = evaluateFollowUp({
      templateKey: TEMPLATE,
      callEvidenceAt: null,
      cooldownHours: 0,
      now: new Date(),
      sentTemplateReceipts: [receipt({ createdAt: isoAgo(HOUR) })],
    })
    expect(result).toBeNull()
  })

  it('flags duplicate_template when the same template was sent within 24h', () => {
    const result = evaluateFollowUp({
      templateKey: TEMPLATE,
      callEvidenceAt: null,
      cooldownHours: 24,
      now: new Date(),
      sentTemplateReceipts: [receipt({ createdAt: isoAgo(HOUR) })],
    })
    expect(result?.code).toBe('duplicate_template')
  })

  it('returns null when the same template was sent 25h ago', () => {
    const result = evaluateFollowUp({
      templateKey: TEMPLATE,
      callEvidenceAt: null,
      cooldownHours: 24,
      now: new Date(),
      sentTemplateReceipts: [receipt({ createdAt: isoAgo(25 * HOUR) })],
    })
    expect(result).toBeNull()
  })

  it('returns null when a different template was sent within 24h', () => {
    const result = evaluateFollowUp({
      templateKey: TEMPLATE,
      callEvidenceAt: null,
      cooldownHours: 24,
      now: new Date(),
      sentTemplateReceipts: [
        receipt({ templateKey: OTHER_TEMPLATE, createdAt: isoAgo(HOUR) }),
      ],
    })
    expect(result).toBeNull()
  })

  it('returns null when cooldown is 0', () => {
    const result = evaluateFollowUp({
      templateKey: TEMPLATE,
      callEvidenceAt: null,
      cooldownHours: 0,
      now: new Date(),
      sentTemplateReceipts: [receipt({ createdAt: isoAgo(1000) })],
    })
    expect(result).toBeNull()
  })

  it.each(['blocked', 'failed'] as const)('ignores %s receipts for both rules (nothing went out)', (outcome) => {
    const result = evaluateFollowUp({
      templateKey: TEMPLATE,
      callEvidenceAt: isoAgo(2 * HOUR),
      cooldownHours: 24,
      now: new Date(),
      sentTemplateReceipts: [receipt({ outcome, createdAt: isoAgo(HOUR) })],
    })
    expect(result).toBeNull()
  })

  it('a send whose outcome is still unknown counts as sent for both rules (it may well have gone out)', () => {
    const afterCall = evaluateFollowUp({
      templateKey: TEMPLATE,
      callEvidenceAt: isoAgo(2 * HOUR),
      cooldownHours: 24,
      now: new Date(),
      sentTemplateReceipts: [receipt({ outcome: 'unknown', blockReason: 'send_unknown', createdAt: isoAgo(HOUR) })],
    })
    expect(afterCall?.code).toBe('already_followed_up')
    const cooldown = evaluateFollowUp({
      templateKey: TEMPLATE,
      callEvidenceAt: null,
      cooldownHours: 24,
      now: new Date(),
      sentTemplateReceipts: [receipt({ outcome: 'unknown', blockReason: 'send_unknown', createdAt: isoAgo(HOUR) })],
    })
    expect(cooldown?.code).toBe('duplicate_template')
  })

  it('prefers already_followed_up when both rules would apply', () => {
    const result = evaluateFollowUp({
      templateKey: TEMPLATE,
      callEvidenceAt: isoAgo(2 * HOUR),
      cooldownHours: 24,
      now: new Date(),
      sentTemplateReceipts: [receipt({ createdAt: isoAgo(HOUR) })],
    })
    expect(result?.code).toBe('already_followed_up')
  })

  it('ignores receipts with an unparsable createdAt', () => {
    const result = evaluateFollowUp({
      templateKey: TEMPLATE,
      callEvidenceAt: isoAgo(2 * HOUR),
      cooldownHours: 24,
      now: new Date(),
      sentTemplateReceipts: [receipt({ createdAt: 'not-a-date' })],
    })
    expect(result).toBeNull()
  })

  it('treats a receipt exactly cooldownHours old as duplicate (>=)', () => {
    const now = new Date()
    const createdAt = new Date(now.getTime() - 24 * HOUR).toISOString()
    const result = evaluateFollowUp({
      templateKey: TEMPLATE,
      callEvidenceAt: null,
      cooldownHours: 24,
      now,
      sentTemplateReceipts: [receipt({ createdAt })],
    })
    expect(result?.code).toBe('duplicate_template')
  })

  it('does not treat a receipt one millisecond older than cooldown as duplicate', () => {
    const now = new Date()
    const createdAt = new Date(now.getTime() - 24 * HOUR - 1).toISOString()
    const result = evaluateFollowUp({
      templateKey: TEMPLATE,
      callEvidenceAt: null,
      cooldownHours: 24,
      now,
      sentTemplateReceipts: [receipt({ createdAt })],
    })
    expect(result).toBeNull()
  })
})
