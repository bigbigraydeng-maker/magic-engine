import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

import {
  createSendGateData,
  guardClient,
  type SendGatesProdArgs,
} from '@/lib/crm/email-templates/send-gates-prod'
import {
  emptyMeta,
  type InLockArgs,
  type MailNewGates,
  type PreLockArgs,
} from '@/lib/crm/email-templates/send-gates'
import type { PublishedTourFactsRead } from '@/lib/tour-catalog/publish-contract'
import { createQueryStub, fail, ok } from './query-stub'

const CLIENT = 'client-1'
const NOW = new Date('2026-10-28T02:00:00.000Z')

const args: SendGatesProdArgs = {
  clientId: CLIENT,
  listActiveMailboxes: async () => [],
  graphGetPage: async () => ({ ok: true, json: { value: [] } }),
}

function dataWith(
  tables: Parameters<typeof createQueryStub>[0],
  read: () => Promise<PublishedTourFactsRead> = async () => ({ published: false }),
) {
  const stub = createQueryStub(tables)
  const loadPublishedTourFacts = vi.fn(read)
  const data = createSendGateData(stub.db, args, { loadPublishedTourFacts })
  return { stub, data, loadPublishedTourFacts }
}

describe('loadFacts', () => {
  it('passes the published snapshot through with its version', async () => {
    const tour = { name: 'Spring Tour' } as unknown as Extract<PublishedTourFactsRead, { published: true }>['tours'][number]
    const { data, loadPublishedTourFacts } = dataWith({}, async () => ({ published: true, version: 7, tours: [tour] }))
    const res = await data.loadFacts(CLIENT, '2026-10-28')
    expect(res).toEqual({ ok: true, version: 7, tours: [tour] })
    expect(loadPublishedTourFacts).toHaveBeenCalledWith(expect.anything(), CLIENT, '2026-10-28')
  })

  it('reads "nothing published yet" as an empty catalog at version 0', async () => {
    const { data } = dataWith({})
    expect(await data.loadFacts(CLIENT, '2026-10-28')).toEqual({ ok: true, version: 0, tours: [] })
  })

  it('reports a failed read instead of pretending the catalog is empty', async () => {
    const { data } = dataWith({}, async () => {
      throw new Error('catalog down')
    })
    expect(await data.loadFacts(CLIENT, '2026-10-28')).toEqual({ ok: false, error: 'catalog down' })
  })
})

describe('loadContactView', () => {
  const contact = { display_name: 'Lisa Chen', primary_email: ' Lisa@Example.com ' }
  const identities = [{ value: 'lisa@example.com' }, { value: 'Lisa.Work@Example.com' }]

  it('is null when the contact is not in this client', async () => {
    const { stub, data } = dataWith({ contacts: ok(null) })
    expect(await data.loadContactView(CLIENT, 'contact-1', 72, NOW)).toBeNull()
    expect(stub.of('contacts')).toContainEqual({ table: 'contacts', method: 'eq', args: ['client_id', CLIENT] })
  })

  it('merges primary and identity addresses without duplicates, lower-cased', async () => {
    const { data } = dataWith({ contacts: ok(contact), contact_identities: ok(identities), contact_touchpoints: ok([]) })
    const view = await data.loadContactView(CLIENT, 'contact-1', 72, NOW)
    expect(view?.addresses.sort()).toEqual(['lisa.work@example.com', 'lisa@example.com'])
    expect(view?.displayName).toBe('Lisa Chen')
    expect(view?.callEvidenceAt).toBeNull()
  })

  it('takes the most recent connected SYSTEM call as evidence and ignores typed notes', async () => {
    const { stub, data } = dataWith({
      contacts: ok(contact),
      contact_identities: ok(identities),
      contact_touchpoints: ok([
        { occurred_at: '2026-10-28T01:30:00Z', source: 'me_manual', metadata: { outcome: 'spoke' } },
        { occurred_at: '2026-10-28T01:00:00Z', source: 'phone/voipline', metadata: { answered: true, talk_seconds: 95 } },
        { occurred_at: '2026-10-27T20:00:00Z', source: 'phone/voipline', metadata: { reached: false } },
      ]),
    })
    const view = await data.loadContactView(CLIENT, 'contact-1', 72, NOW)
    expect(view?.callEvidenceAt).toBe('2026-10-28T01:00:00Z')
    const calls = stub.of('contact_touchpoints')
    expect(calls).toContainEqual({ table: 'contact_touchpoints', method: 'eq', args: ['client_id', CLIENT] })
    expect(calls).toContainEqual({ table: 'contact_touchpoints', method: 'eq', args: ['channel', 'phone'] })
    expect(calls).toContainEqual({
      table: 'contact_touchpoints',
      method: 'gte',
      args: ['occurred_at', new Date(NOW.getTime() - 72 * 3_600_000).toISOString()],
    })
  })

  it('throws (so the send is refused) when any read fails', async () => {
    const { data } = dataWith({ contacts: ok(contact), contact_identities: fail('boom'), contact_touchpoints: ok([]) })
    await expect(data.loadContactView(CLIENT, 'contact-1', 72, NOW)).rejects.toThrow(/contact_identities/)
  })
})

describe('loadSenderName', () => {
  it('returns the staff member display name', async () => {
    const { stub, data } = dataWith({ client_portal_users: ok([{ display_name: 'Lisa' }]) })
    expect(await data.loadSenderName(CLIENT, ' Lisa@CTS.example ')).toBe('Lisa')
    expect(stub.of('client_portal_users')).toContainEqual({
      table: 'client_portal_users',
      method: 'eq',
      args: ['email', 'lisa@cts.example'],
    })
  })

  it('is null when there is no such staff row', async () => {
    const { data } = dataWith({ client_portal_users: ok([]) })
    expect(await data.loadSenderName(CLIENT, 'nobody@cts.example')).toBeNull()
  })

  it('throws when the read fails', async () => {
    const { data } = dataWith({ client_portal_users: fail('boom') })
    await expect(data.loadSenderName(CLIENT, 'lisa@cts.example')).rejects.toThrow(/client_portal_users/)
  })
})

describe('guardClient', () => {
  const config = {} as unknown as PreLockArgs['config']
  const preLock = (clientId: string): PreLockArgs => ({
    clientId,
    contactId: 'contact-1',
    sentByEmail: 'lisa@cts.example',
    config,
    subject: 's',
    body: 'b',
    footer: null,
    template: null,
    to: 'guest@example.com',
    now: NOW,
  })

  function inner(): { gates: MailNewGates; pre: ReturnType<typeof vi.fn>; inLock: ReturnType<typeof vi.fn> } {
    const pre = vi.fn(async () => ({ ok: true as const, meta: emptyMeta(), state: {} as never }))
    const inLock = vi.fn(async () => ({ ok: true as const, meta: emptyMeta() }))
    return { gates: { preLock: pre, inLock }, pre, inLock }
  }

  it('lets calls for its own client through', async () => {
    const { gates, pre } = inner()
    const res = await guardClient(CLIENT, gates).preLock(preLock(CLIENT))
    expect(res.ok).toBe(true)
    expect(pre).toHaveBeenCalledTimes(1)
  })

  it('refuses a call for another client without running any gate', async () => {
    const { gates, pre, inLock } = inner()
    const guarded = guardClient(CLIENT, gates)
    const before = await guarded.preLock(preLock('client-2'))
    expect(before).toMatchObject({ ok: false, status: 503, reason: 'internal_error' })
    const lock: InLockArgs = {
      clientId: 'client-2',
      contactId: 'contact-1',
      config,
      state: {} as never,
      meta: emptyMeta(),
      now: NOW,
    }
    const during = await guarded.inLock(lock)
    expect(during).toMatchObject({ ok: false, status: 503, reason: 'internal_error' })
    expect(pre).not.toHaveBeenCalled()
    expect(inLock).not.toHaveBeenCalled()
  })
})
