import { describe, expect, it } from 'vitest'
import { makeFakeSupabase } from '@/lib/memory/__tests__/fake-supabase'
import { gscSiteUrlFromConfig, loadGscConnectedClients } from '../connected-clients'

const A = 'c0000000-0000-0000-0000-000000000000'
const B = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
const C = '4ae76381-cd45-43bd-85cd-98cfd7604007'

describe('loadGscConnectedClients', () => {
  it('returns connected GSC clients with a trimmed site_url and ignores everything else', async () => {
    const supabase = makeFakeSupabase({
      client_connectors: [
        { client_id: A, anchor: 'gsc', status: 'connected', config: { site_url: ' https://a.example.com/ ' } },
        { client_id: B, anchor: 'gsc', status: 'connected', config: { site_url: 'sc-domain:b.example.com' } },
        { client_id: C, anchor: 'ga4', status: 'connected', config: { property_id: '123' } },
        { client_id: C, anchor: 'gsc', status: 'not_connected', config: { site_url: 'https://c.example.com/' } },
        { client_id: 'e0000000-0000-0000-0000-000000000000', anchor: 'gsc', status: 'connected', config: { site_url: '   ' } },
        { client_id: 'f0000000-0000-0000-0000-000000000000', anchor: 'gsc', status: 'connected', config: null },
      ],
    })

    const result = await loadGscConnectedClients(supabase)

    expect(result).toEqual({
      ok: true,
      clients: [
        { clientId: A, siteUrl: 'https://a.example.com/' },
        { clientId: B, siteUrl: 'sc-domain:b.example.com' },
      ],
    })
  })

  it('read failure → ok:false with the database reason (never an empty roster)', async () => {
    const supabase = makeFakeSupabase(
      { client_connectors: [] },
      { failSelectOn: ['client_connectors'] },
    )

    const result = await loadGscConnectedClients(supabase)

    expect(result).toEqual({ ok: false, reason: 'simulated read failure on client_connectors' })
  })
})

describe('gscSiteUrlFromConfig', () => {
  it('trims a usable site_url and rejects everything else', () => {
    expect(gscSiteUrlFromConfig({ site_url: ' https://a.com/ ' })).toBe('https://a.com/')
    expect(gscSiteUrlFromConfig({ site_url: '' })).toBeNull()
    expect(gscSiteUrlFromConfig({ site_url: 5 })).toBeNull()
    expect(gscSiteUrlFromConfig({})).toBeNull()
    expect(gscSiteUrlFromConfig(null)).toBeNull()
    expect(gscSiteUrlFromConfig('https://a.com/')).toBeNull()
  })
})
