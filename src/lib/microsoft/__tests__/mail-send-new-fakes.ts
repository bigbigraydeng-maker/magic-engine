/**
 * `sendMailNew` 测试用的内存替身：数据库和 Graph 都在内存里，每一次调用都记下来，
 * 测试可以断言「到底有没有碰 Graph / 有没有写审计 / 写了什么」。
 */

import { vi } from 'vitest'
import type { ManualSendDncGate } from '@/lib/crm/manual-send-dnc-gate'
import type { TouchKind } from '@/lib/crm/email-compose/enquiry-record'
import type {
  GraphSendOutcome,
  MailNewDeps,
  MailNewGraph,
  MailNewStore,
  MailboxChoice,
  PendingDraft,
  PriorSend,
  SendMailNewInput,
} from '../mail-send-new'

export const REQUEST_ID = '11111111-1111-4111-8111-111111111111'

export const NOW = new Date('2026-10-21T00:00:00Z')

export function baseInput(over: Partial<SendMailNewInput> = {}): SendMailNewInput {
  return {
    clientId: 'client-a',
    contactId: 'contact-1',
    subject: 'Your China trip enquiry',
    body: 'Hi Amy,\nThanks for your enquiry.',
    sentByEmail: 'sales@client.co.nz',
    requestId: REQUEST_ID,
    expectedRecipient: 'amy@gmail.com',
    ...over,
  }
}

export interface FakeOpts {
  leadsConfig?: unknown
  leadsConfigThrows?: boolean
  contact?: { id: string; primaryEmail: string | null } | null
  identityEmails?: string[]
  touchKinds?: TouchKind[]
  dnc?: ManualSendDncGate
  mailboxes?: MailboxChoice[]
  prior?: PriorSend | null
  pending?: PendingDraft[]
  usage?: { userLastHour: number; userLastDay: number; mailboxLastDay: number }
  lockAvailable?: boolean
  claim?: 'claimed' | 'taken' | 'error'
  auditInsertFails?: boolean
  rekeyOk?: boolean
  recordSentThrows?: boolean
  whoAmI?: string | null
  createDraft?: { id: string; conversationId: string } | { error: string }
  sendOutcome?: GraphSendOutcome
  isStillDraft?: Record<string, boolean | null>
}

export const ENABLED = { email_compose: { enabled: true } }

export function makeFakes(o: FakeOpts = {}) {
  const calls: string[] = []
  const audits: Array<{ id: string; status: string; meta: string | null; error: string | null }> = []
  const patches: Array<{ auditId: string; patch: Record<string, unknown> }> = []
  const rekeys: string[] = []
  const recorded: Array<Record<string, unknown>> = []
  const deletedDrafts: string[] = []

  const store: MailNewStore = {
    loadLeadsConfig: vi.fn(async () => {
      calls.push('loadLeadsConfig')
      if (o.leadsConfigThrows) throw new Error('db down')
      return o.leadsConfig ?? ENABLED
    }),
    checkDnc: vi.fn(async (): Promise<ManualSendDncGate> => {
      calls.push('checkDnc')
      return o.dnc ?? { blocked: false }
    }),
    loadContact: vi.fn(async () => {
      calls.push('loadContact')
      return o.contact === undefined ? { id: 'contact-1', primaryEmail: 'amy@gmail.com' } : o.contact
    }),
    loadIdentityEmails: vi.fn(async () => o.identityEmails ?? []),
    loadTouchKinds: vi.fn(async (): Promise<TouchKind[]> => o.touchKinds ?? [{ channel: 'messenger', source: 'messenger', direction: 'inbound' }]),
    listActiveMailboxes: vi.fn(async () => o.mailboxes ?? [{ connectionId: 'conn-1', account: 'info@client.co.nz' }]),
    findPriorSend: vi.fn(async () => o.prior ?? null),
    listPendingDrafts: vi.fn(async () => o.pending ?? []),
    countUsage: vi.fn(async () => o.usage ?? { userLastHour: 0, userLastDay: 0, mailboxLastDay: 0 }),
    acquireContactLock: vi.fn(async () => {
      calls.push('acquireLock')
      return o.lockAvailable ?? true
    }),
    releaseContactLock: vi.fn(async () => {
      calls.push('releaseLock')
    }),
    claimConversation: vi.fn(async () => {
      calls.push('claim')
      const k = o.claim ?? 'claimed'
      return k === 'claimed' ? { kind: 'claimed' as const, conversationId: 'conv-1' } : { kind: k }
    }),
    insertAudit: vi.fn(async () => {
      calls.push('insertAudit')
      if (o.auditInsertFails) return null
      audits.push({ id: 'audit-1', status: 'pending', meta: null, error: null })
      return 'audit-1'
    }),
    patchAudit: vi.fn(async (auditId, patch) => {
      patches.push({ auditId, patch })
      const a = audits.find((x) => x.id === auditId)
      if (a) {
        if (patch.status) a.status = patch.status
        if (patch.metaMessageId) a.meta = patch.metaMessageId
        if (patch.errorMessage) a.error = patch.errorMessage
      }
    }),
    rekeyConversation: vi.fn(async (_id, key) => {
      rekeys.push(key)
      return o.rekeyOk ?? true
    }),
    discardConversation: vi.fn(async () => {
      calls.push('discardConversation')
    }),
    recordSent: vi.fn(async (args) => {
      calls.push('recordSent')
      if (o.recordSentThrows) throw new Error('write failed')
      recorded.push(args)
    }),
  }

  const graph: MailNewGraph = {
    whoAmI: vi.fn(async () => {
      calls.push('whoAmI')
      return o.whoAmI === undefined ? 'info@client.co.nz' : o.whoAmI
    }),
    createDraft: vi.fn(async () => {
      calls.push('createDraft')
      return o.createDraft ?? { id: 'draft-1', conversationId: 'graph-conv-1' }
    }),
    sendDraft: vi.fn(async () => {
      calls.push('sendDraft')
      return o.sendOutcome ?? 'sent'
    }),
    deleteDraft: vi.fn(async (_c, id) => {
      calls.push('deleteDraft')
      deletedDrafts.push(id)
    }),
    isStillDraft: vi.fn(async (_c, id) => (o.isStillDraft ? (o.isStillDraft[id] ?? null) : null)),
  }

  const deps: MailNewDeps = { store, graph, now: () => NOW }
  return { deps, store, graph, calls, audits, patches, rekeys, recorded, deletedDrafts }
}
