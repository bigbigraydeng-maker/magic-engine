// @vitest-environment node
/**
 * Runs the REAL Supabase client library (only the network is replaced by a stub) to prove what the
 * signed link looks like once the file name has been added. The in-memory stand-in used by the other
 * tests returns a ready-made link, so it cannot show how the SDK treats characters such as & # +.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requests = vi.hoisted(() => ({ calls: [] as Array<{ url: string; method: string; body: string }> }))

vi.mock('@/lib/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  const stub = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    requests.calls.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : '' })
    const marker = '/storage/v1/object/sign/'
    if (url.includes(marker)) {
      const signedPath = url.split(marker)[1]
      return new Response(JSON.stringify({ signedURL: `/object/sign/${signedPath}?token=signed-token` }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return { supabaseAdmin: createClient('https://proj.supabase.co', 'service-key', { global: { fetch: stub } }) }
})

import { createDownloadUrl } from '../storage'

const CLIENT = '11111111-1111-4111-8111-111111111111'
const DOC = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PATH = `${CLIENT}/${DOC}/file.pdf`

const NAMES = [
  'Plain name.pdf',
  'Hiking & Walking Tours 2027.pdf',
  'Tour #5 Shanghai.pdf',
  '#1 Brochure.pdf',
  'C++ Guide.pdf',
  '100% Pure NZ.pdf',
  'a=b&download=evil.pdf',
  '中国手册 v11.pdf',
  'two  spaces.pdf',
]

beforeEach(() => { requests.calls = [] })

describe('signed link built by the real SDK', () => {
  it.each(NAMES)('keeps the file name intact: %s', async name => {
    const result = await createDownloadUrl(PATH, name)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const url = new URL(result.url)
    expect(url.searchParams.get('download')).toBe(name)
    expect(url.searchParams.getAll('download')).toHaveLength(1)
    expect(url.searchParams.get('token')).toBe('signed-token')
    expect([...url.searchParams.keys()].sort()).toEqual(['download', 'token'])
    expect(url.hash).toBe('')
    expect(url.pathname).toBe(`/storage/v1/object/sign/me-client-documents/${PATH}`)
  })

  it('asks the storage service for a 60-second link on the private bucket, and nothing else', async () => {
    await createDownloadUrl(PATH, 'a.pdf')
    expect(requests.calls).toHaveLength(1)
    expect(requests.calls[0].method).toBe('POST')
    expect(requests.calls[0].url).toBe(`https://proj.supabase.co/storage/v1/object/sign/me-client-documents/${PATH}`)
    expect(JSON.parse(requests.calls[0].body)).toEqual({ expiresIn: 60 })
  })
})
