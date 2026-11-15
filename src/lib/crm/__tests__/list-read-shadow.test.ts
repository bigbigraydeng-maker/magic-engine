// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { compareShadowRead, readListVersion, resetListShadowForTests, shadowEnabled } from '../list-read-shadow'

const C = 'client-a'

describe('compareShadowRead', () => {
  beforeEach(() => resetListShadowForTests())

  it('remembers the first read, then matches identical rows at the same version', () => {
    expect(compareShadowRead('r', C, 5, 5, [{ id: 'a', v: 1 }]).outcome).toBe('first')
    expect(compareShadowRead('r', C, 5, 5, [{ id: 'a', v: 1 }]).outcome).toBe('match')
  })

  it('ignores row order', () => {
    compareShadowRead('r', C, 5, 5, [{ id: 'a' }, { id: 'b' }])
    expect(compareShadowRead('r', C, 5, 5, [{ id: 'b' }, { id: 'a' }]).outcome).toBe('match')
  })

  it('reports a change the version did not record, with sample ids', () => {
    compareShadowRead('r', C, 5, 5, [{ id: 'a', v: 1 }, { id: 'b', v: 1 }])
    const res = compareShadowRead('r', C, 5, 5, [{ id: 'a', v: 2 }, { id: 'b', v: 1 }])
    expect(res.outcome).toBe('mismatch')
    expect(res.added).toBe(1)
    expect(res.removed).toBe(1)
    expect(res.sampleIds).toEqual(['a', 'a'])
  })

  it('does not compare across versions', () => {
    compareShadowRead('r', C, 5, 5, [{ id: 'a', v: 1 }])
    expect(compareShadowRead('r', C, 6, 6, [{ id: 'a', v: 2 }]).outcome).toBe('version_changed')
    expect(compareShadowRead('r', C, 6, 6, [{ id: 'a', v: 2 }]).outcome).toBe('match')
  })

  it('skips and does not remember when a change landed mid-read', () => {
    compareShadowRead('r', C, 5, 5, [{ id: 'a', v: 1 }])
    expect(compareShadowRead('r', C, 5, 6, [{ id: 'a', v: 2 }]).outcome).toBe('skipped')
    expect(compareShadowRead('r', C, 5, 5, [{ id: 'a', v: 1 }]).outcome).toBe('match')
  })

  it('skips when the version could not be read', () => {
    expect(compareShadowRead('r', C, null, null, [{ id: 'a' }]).outcome).toBe('skipped')
  })

  it('keeps clients and reads apart', () => {
    compareShadowRead('r', C, 5, 5, [{ id: 'a', v: 1 }])
    expect(compareShadowRead('r', 'client-b', 5, 5, [{ id: 'a', v: 2 }]).outcome).toBe('first')
    expect(compareShadowRead('other', C, 5, 5, [{ id: 'a', v: 2 }]).outcome).toBe('first')
  })
})

describe('shadowEnabled', () => {
  it('is on unless explicitly turned off', () => {
    expect(shadowEnabled({})).toBe(true)
    expect(shadowEnabled({ CRM_LIST_SHADOW: 'OFF ' })).toBe(false)
  })
})

// The REAL Supabase client library runs here; only the network is a stub.
describe('readListVersion', () => {
  function realClient(respond: (url: string, method: string) => Response, seen: string[]) {
    const stub = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input)
      seen.push(`${init?.method ?? 'GET'} ${url}`)
      return respond(url, init?.method ?? 'GET')
    }
    return createClient('https://proj.supabase.co', 'service-key', { global: { fetch: stub } })
  }

  it('asks for a count of this client only and reads no rows', async () => {
    const seen: string[] = []
    const db = realClient(() => new Response(null, { status: 200, headers: { 'content-range': '*/42' } }), seen)
    expect(await readListVersion(db, C)).toBe(42)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatch(/^HEAD https:\/\/proj\.supabase\.co\/rest\/v1\/crm_list_change_log\?select=id&client_id=eq\.client-a$/)
  })

  it('returns null when the read fails instead of throwing', async () => {
    const failing = realClient(() => new Response(JSON.stringify({ message: 'denied' }), { status: 403 }), [])
    expect(await readListVersion(failing, C)).toBeNull()
    const offline = createClient('https://proj.supabase.co', 'k', { global: { fetch: () => Promise.reject(new Error('offline')) } })
    expect(await readListVersion(offline, C)).toBeNull()
  })
})
