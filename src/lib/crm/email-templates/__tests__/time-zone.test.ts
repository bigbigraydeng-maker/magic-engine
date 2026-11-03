import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_TIME_ZONE, isValidTimeZone, loadClientTimeZone, timeZoneForCountry } from '@/lib/crm/email-templates/time-zone'
import { createSendGates, resolveTimeZone, type PreLockArgs } from '@/lib/crm/email-templates/send-gates'
import { previewTemplate } from '@/lib/crm/email-templates/template-preview'
import { createQueryStub, fail, ok } from './query-stub'
import { config, makeData, template, tour } from './fixtures'

afterEach(() => vi.restoreAllMocks())

describe('timeZoneForCountry (the CRM rule: AU is Sydney, everyone else New Zealand)', () => {
  it.each([
    ['AU', 'Australia/Sydney'],
    [' au ', 'Australia/Sydney'],
    ['NZ', 'Pacific/Auckland'],
    ['US', 'Pacific/Auckland'],
    [null, 'Pacific/Auckland'],
    [undefined, 'Pacific/Auckland'],
    [42, 'Pacific/Auckland'],
  ])('%s -> %s', (country, zone) => {
    expect(timeZoneForCountry(country)).toBe(zone)
  })

  it('the default is the main market\'s zone', () => {
    expect(DEFAULT_TIME_ZONE).toBe('Pacific/Auckland')
  })
})

describe('isValidTimeZone', () => {
  it('accepts real zones and rejects nonsense', () => {
    expect(isValidTimeZone('Australia/Perth')).toBe(true)
    expect(isValidTimeZone('Mars/Olympus')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
  })
})

describe('loadClientTimeZone', () => {
  it('reads the country of THIS client', async () => {
    const stub = createQueryStub({ clients: ok({ country: 'AU' }) })
    expect(await loadClientTimeZone(stub.db, 'client-a')).toBe('Australia/Sydney')
    expect(stub.of('clients')).toContainEqual({ table: 'clients', method: 'eq', args: ['id', 'client-a'] })
  })

  it('a client without a country is on the default zone; a failed read is an error (the caller falls back)', async () => {
    expect(await loadClientTimeZone(createQueryStub({ clients: ok({ country: null }) }).db, 'c')).toBe('Pacific/Auckland')
    expect(await loadClientTimeZone(createQueryStub({ clients: ok(null) }).db, 'c')).toBe('Pacific/Auckland')
    await expect(loadClientTimeZone(createQueryStub({ clients: fail('boom') }).db, 'c')).rejects.toThrow('clients.country')
  })
})

describe('resolveTimeZone', () => {
  it('uses the data layer\'s answer, else the fallback — also when the read fails or the answer is not a zone', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await resolveTimeZone({}, 'c', 'Pacific/Auckland')).toBe('Pacific/Auckland')
    expect(await resolveTimeZone({ loadTimeZone: async () => 'Australia/Sydney' }, 'c', 'Pacific/Auckland')).toBe('Australia/Sydney')
    expect(await resolveTimeZone({ loadTimeZone: async () => 'Mars/Olympus' }, 'c', 'Pacific/Auckland')).toBe('Pacific/Auckland')
    expect(
      await resolveTimeZone(
        {
          loadTimeZone: async () => {
            throw new Error('db down')
          },
        },
        'c',
        'Pacific/Auckland',
      ),
    ).toBe('Pacific/Auckland')
  })
})

// 2026-10-27 12:30 UTC is already 28 October (01:30) in Auckland but still the 27th (23:30) in Sydney.
const EDGE = new Date('2026-10-27T12:30:00.000Z')

describe('"today" is the client\'s today', () => {
  const preArgs = (): PreLockArgs => ({
    clientId: 'client-a',
    contactId: 'contact-1',
    sentByEmail: 'lisa@client.co.nz',
    config: config(),
    subject: 'x',
    body: 'y',
    footer: null,
    template: null,
    to: 'amy@gmail.com',
    now: EDGE,
  })
  const dataIn = (zone: string) => makeData({ loadTimeZone: vi.fn(async () => zone), loadFacts: vi.fn(async () => ({ ok: true as const, version: 7, tours: [tour()] })) })

  it.each([
    ['Pacific/Auckland', '2026-10-28'],
    ['Australia/Sydney', '2026-10-27'],
  ])('the real send asks the catalog for what is still ahead on the client\'s own date (%s -> %s)', async (zone, date) => {
    const data = dataIn(zone)
    await createSendGates(data).preLock(preArgs())
    expect(data.loadFacts).toHaveBeenCalledWith('client-a', date)
  })

  it('the preview agrees with the real send', async () => {
    const data = dataIn('Australia/Sydney')
    await previewTemplate(
      { clientId: 'client-a', contactId: 'contact-1', sentByEmail: 'lisa@client.co.nz', config: config(), request: { key: 'post-call-single-tour', picks: [], inputs: {}, callBasis: 'none' }, now: EDGE },
      data,
    )
    expect(data.loadFacts).toHaveBeenCalledWith('client-a', '2026-10-27')
  })

  it('"we spoke today / yesterday" is counted on the client\'s calendar', async () => {
    const callAt = '2026-10-27T12:30:00Z' // Auckland: the 28th, 01:30 — Sydney: the 27th, 23:30
    const run = async (zone: string) => {
      const data = makeData({
        loadTemplate: vi.fn(async () => template({ factSource: 'none', pickMode: 'none', subject: 'Thanks', body: 'We spoke {{call_when}}.' })),
        loadTimeZone: vi.fn(async () => zone),
        loadContactView: vi.fn(async () => ({ displayName: 'Amy Lee', addresses: ['amy@gmail.com'], callEvidenceAt: callAt })),
      })
      const later = new Date('2026-10-28T02:00:00.000Z') // Auckland: the 28th, 15:00 — Sydney: the 28th, 13:00
      const res = await previewTemplate(
        { clientId: 'client-a', contactId: 'contact-1', sentByEmail: 'lisa@client.co.nz', config: config({ providers: {} }), request: { key: 'post-call-single-tour', picks: [], inputs: {}, callBasis: 'none' }, now: later },
        data,
      )
      return res.ok ? res.rendered.body : res.error
    }
    expect(await run('Pacific/Auckland')).toBe('We spoke today.')
    expect(await run('Australia/Sydney')).toBe('We spoke yesterday.')
  })
})
