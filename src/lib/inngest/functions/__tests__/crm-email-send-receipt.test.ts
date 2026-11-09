import { describe, expect, it, vi } from 'vitest'
import {
  SETTLE_AFTER,
  crmEmailSendReceipt,
  runCrmEmailSendReceipt,
  runSettleStep,
  type SettleStepTools,
} from '../crm-email-send-receipt'
import { CRM_EMAIL_SEND_ATTEMPTED } from '../../crm-email-events'
import type { SettleDeps, SettleResult } from '@/lib/crm/email-templates/settle-unknown'
import type { StoredReceipt } from '@/lib/crm/email-templates/types'

const CLIENT = 'client-1'
const CONTACT = '11111111-1111-4111-8111-111111111111'
const REQUEST = '22222222-2222-4222-8222-222222222222'
const unknownEvent = { outcome: 'unknown', client_id: CLIENT, contact_id: CONTACT, request_id: REQUEST }

const stored: StoredReceipt = {
  id: 'row-1',
  authBasis: 'human_click',
  createdAt: '2026-10-28T02:00:00Z',
  clientId: CLIENT,
  contactId: CONTACT,
  requestId: REQUEST,
  actorEmail: 'lisa@cts.example',
  templateKey: null,
  templateVersion: null,
  catalogVersion: null,
  callBasis: 'none',
  outcome: 'unknown',
  blockReason: 'send_unknown',
  blockDetail: null,
  mailbox: 'info@cts.example',
  conversationId: null,
  providerMessageId: null,
  editedAfterRender: null,
  warnings: [],
  renderedSha256: null,
  finalSha256: null,
}

function deps(reconcile: SettleDeps['reconcile']): SettleDeps & { insert: ReturnType<typeof vi.fn> } {
  const insert = vi.fn(async () => ({ ok: true as const, duplicate: false }))
  return { findUnknown: vi.fn(async () => stored), reconcile, insert }
}

function fakeStep() {
  const calls: string[] = []
  const step: SettleStepTools = {
    sleep: vi.fn(async (id: string, duration: string) => {
      calls.push(`sleep:${id}:${duration}`)
    }),
    run: vi.fn(async (id: string, fn: () => Promise<SettleResult>) => {
      calls.push(`run:${id}`)
      return fn()
    }),
  }
  return { step, calls }
}

describe('registration', () => {
  it('is a cloud- function with three retries, triggered by the send-attempt event only', () => {
    expect(crmEmailSendReceipt.id()).toBe('cloud-crm-email-send-receipt')
    const opts = (crmEmailSendReceipt as unknown as { opts: { retries?: number; triggers?: { event?: string }[] } }).opts
    expect(opts.retries).toBe(3)
    expect(opts.triggers).toEqual([{ event: CRM_EMAIL_SEND_ATTEMPTED }])
  })
})

describe('runSettleStep', () => {
  it('ignores events that are not an unknown send, touching nothing', async () => {
    const d = deps(vi.fn(async () => ({ status: 'sent' as const, messageId: 'm', conversationId: 'c' })))
    expect(await runSettleStep({ ...unknownEvent, outcome: 'sent' }, d)).toEqual({ status: 'skipped' })
    expect(d.findUnknown).not.toHaveBeenCalled()
  })

  it('throws while the send is still unresolved, so Inngest retries', async () => {
    const d = deps(vi.fn(async () => ({ status: 'unresolved' as const })))
    await expect(runSettleStep(unknownEvent, d)).rejects.toThrow()
    expect(d.insert).not.toHaveBeenCalled()
  })

  it('settles a send that turned out to be sent', async () => {
    const d = deps(vi.fn(async () => ({ status: 'sent' as const, messageId: 'AAMk1', conversationId: 'conv-1' })))
    expect(await runSettleStep(unknownEvent, d)).toEqual({ status: 'sent' })
    expect(d.insert).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'sent', providerMessageId: 'AAMk1' }))
  })
})

describe('runCrmEmailSendReceipt', () => {
  it('ends at once for every outcome except unknown (no waiting, no steps)', async () => {
    const { step, calls } = fakeStep()
    for (const outcome of ['sent', 'blocked', 'failed']) {
      expect(await runCrmEmailSendReceipt({ ...unknownEvent, outcome }, step)).toEqual({ status: 'skipped' })
    }
    expect(calls).toEqual([])
  })

  it('waits ten minutes before reconciling an unknown send', async () => {
    const { step, calls } = fakeStep()
    const d = deps(vi.fn(async () => ({ status: 'failed' as const })))
    expect(await runCrmEmailSendReceipt(unknownEvent, step, d)).toEqual({ status: 'failed' })
    expect(SETTLE_AFTER).toBe('10m')
    expect(calls).toEqual(['sleep:wait-before-reconcile:10m', 'run:settle'])
  })
})
