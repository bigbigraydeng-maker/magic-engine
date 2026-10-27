import { describe, expect, it } from 'vitest'
import { createSendGates, emptyMeta, type SendGateData } from '@/lib/crm/email-templates/send-gates'
import { effectiveFromSettings } from '@/lib/crm/email-templates/effective-config'
import type { EmailSettings, StoredReceipt } from '@/lib/crm/email-templates/types'

const HOUR = 3_600_000

function settings(over: Partial<EmailSettings>): EmailSettings {
  return {
    enabled: true,
    sendMailbox: null,
    allowUnsolicited: false,
    footer: null,
    limits: { perUserPerHour: 30, perUserPerDay: 100, perMailboxPerDay: 200 },
    frequencyCap: null,
    recipientAllowlist: null,
    sameTemplateCooldownHours: 24,
    callPromptHours: 48,
    guardrails: { allowedLinkHosts: [], rules: [] },
    providers: {},
    ...over,
  }
}

function receipt(createdAt: string, templateKey: string): StoredReceipt {
  return {
    id: 'r1',
    clientId: 'c',
    contactId: 'k',
    requestId: '00000000-0000-4000-8000-0000000000b1',
    actorEmail: 'lisa@example.com',
    templateKey,
    templateVersion: 1,
    catalogVersion: null,
    callBasis: 'system_call',
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
    createdAt,
  }
}

function dataReturning(receipts: StoredReceipt[], seenSince: string[]): SendGateData {
  const unused = async (): Promise<never> => {
    throw new Error('not used in this test')
  }
  return {
    loadTemplate: unused,
    loadFacts: unused,
    loadContactView: unused,
    loadSenderName: unused,
    // honours the cut-off like the real database query does
    sentTemplateReceiptsSince: async (_clientId, _contactId, since) => {
      seenSince.push(since)
      return receipts.filter((r) => r.createdAt >= since)
    },
    frequencySources: {
      sentItems: async () => ({ ok: true, items: [] }),
      audit: async () => ({ ok: true, items: [] }),
      touchpoints: async () => ({ ok: true, items: [] }),
      mailchimp: async () => ({ ok: true, items: [] }),
    },
  }
}

describe('in-lock follow-up look-back', () => {
  it('looks back to the call time even when the call is older than the same-template cooldown', async () => {
    const now = new Date()
    const callAt = new Date(now.getTime() - 30 * HOUR).toISOString()
    const followUpAt = new Date(now.getTime() - 25 * HOUR).toISOString() // after the call, before the 24h cooldown cut-off
    const seenSince: string[] = []
    const gates = createSendGates(dataReturning([receipt(followUpAt, 'another-template')], seenSince))
    const config = effectiveFromSettings(settings({ sameTemplateCooldownHours: 24, callPromptHours: 48 }), 1)

    const result = await gates.inLock({
      clientId: 'c',
      contactId: 'k',
      config,
      state: { templateKey: 'post-call', callEvidenceAt: callAt, addresses: ['a@x.com'] },
      meta: emptyMeta(),
      now,
    })

    expect(result).toMatchObject({ ok: false, reason: 'already_followed_up' })
    expect(Date.parse(seenSince[0])).toBeLessThanOrEqual(Date.parse(callAt))
  })

  it('without call evidence it looks back only as far as the cooldown', async () => {
    const now = new Date()
    const seenSince: string[] = []
    const gates = createSendGates(dataReturning([], seenSince))
    const config = effectiveFromSettings(settings({ sameTemplateCooldownHours: 24 }), 1)

    const result = await gates.inLock({
      clientId: 'c',
      contactId: 'k',
      config,
      state: { templateKey: 'post-call', callEvidenceAt: null, addresses: ['a@x.com'] },
      meta: emptyMeta(),
      now,
    })

    expect(result.ok).toBe(true)
    expect(Math.abs(Date.parse(seenSince[0]) - (now.getTime() - 24 * HOUR))).toBeLessThan(1000)
  })

  it('cooldown 0 and no call evidence means no receipt lookup at all', async () => {
    const seenSince: string[] = []
    const gates = createSendGates(dataReturning([], seenSince))
    const config = effectiveFromSettings(settings({ sameTemplateCooldownHours: 0 }), 1)
    const result = await gates.inLock({
      clientId: 'c',
      contactId: 'k',
      config,
      state: { templateKey: 'post-call', callEvidenceAt: null, addresses: ['a@x.com'] },
      meta: emptyMeta(),
      now: new Date(),
    })
    expect(result.ok).toBe(true)
    expect(seenSince).toHaveLength(0)
  })
})
