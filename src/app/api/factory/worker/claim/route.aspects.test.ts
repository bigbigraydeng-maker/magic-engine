import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { rpcMock, fromMock, signMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  fromMock: vi.fn(),
  signMock: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    rpc: rpcMock,
    from: fromMock,
    storage: { from: () => ({ createSignedUploadUrl: signMock }) },
  },
}))

import { POST } from './route'

const CLIENT = '10000000-0000-0000-0000-000000000001'
const WO = '20000000-0000-0000-0000-000000000002'

function claimRequest(body: unknown) {
  return new NextRequest('http://localhost/api/factory/worker/claim', {
    method: 'POST',
    headers: { authorization: 'Bearer test-worker-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/factory/worker/claim aspect uploads', () => {
  const oldToken = process.env.FACTORY_WORKER_TOKEN
  const oldClients = process.env.FACTORY_WORKER_CLIENT_IDS

  beforeEach(() => {
    process.env.FACTORY_WORKER_TOKEN = 'test-worker-token'
    process.env.FACTORY_WORKER_CLIENT_IDS = CLIENT
    signMock.mockReset().mockImplementation(async (path: string) => ({
      data: { signedUrl: `https://signed.example/${path}`, token: 'tok' },
      error: null,
    }))
    fromMock.mockReset().mockImplementation((table: string) => {
      if (table !== 'clients') throw new Error(`unexpected table ${table}`)
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { factory_config: {} }, error: null }) }) }) }
    })
  })

  afterEach(() => {
    if (oldToken === undefined) delete process.env.FACTORY_WORKER_TOKEN
    else process.env.FACTORY_WORKER_TOKEN = oldToken
    if (oldClients === undefined) delete process.env.FACTORY_WORKER_CLIENT_IDS
    else process.env.FACTORY_WORKER_CLIENT_IDS = oldClients
  })

  function claimed(brief: Record<string, unknown>) {
    rpcMock.mockReset().mockResolvedValue({
      data: [{ ok: true, work_order_id: WO, client_id: CLIENT, brief, budget_cap_usd: 1 }],
      error: null,
    })
  }

  it('does not sign extra files when the brief does not ask', async () => {
    claimed({ remotion: { template: 'list', props: {} } })
    const response = await POST(claimRequest({ worker_id: 'mac-a' }))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.aspect_uploads).toBeUndefined()
    expect(signMock.mock.calls.map((c) => c[0])).toEqual([
      `renders/${CLIENT}/${WO}/final.mp4`,
      `renders/${CLIENT}/${WO}/segments.json`,
      `renders/${CLIENT}/${WO}/captions.srt`,
    ])
  })

  it('signs one sibling file per extra ratio', async () => {
    claimed({ remotion: { template: 'list', props: {}, aspects: ['4:5', '16:9'] } })
    const response = await POST(claimRequest({ worker_id: 'mac-a' }))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.aspect_uploads.map((row: { aspect: string; path: string }) => [row.aspect, row.path])).toEqual([
      ['4:5', `renders/${CLIENT}/${WO}/final-4x5.mp4`],
      ['16:9', `renders/${CLIENT}/${WO}/final-16x9.mp4`],
    ])
    expect(body.uploads.video.path).toBe(`renders/${CLIENT}/${WO}/final.mp4`)
  })

  it('returns aspect_error with the claimed id when an extra signature fails', async () => {
    claimed({ remotion: { template: 'list', props: {}, aspects: ['4:5', '16:9'] } })
    signMock.mockImplementation(async (path: string) => {
      if (String(path).endsWith('final-16x9.mp4')) {
        return { data: null, error: { message: 'bucket down' } }
      }
      return { data: { signedUrl: `https://signed.example/${path}`, token: 'tok' }, error: null }
    })
    const response = await POST(claimRequest({ worker_id: 'mac-a' }))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.claimed).toBe(true)
    expect(body.work_order_id).toBe(WO)
    expect(body.aspect_error).toContain('16:9')
    expect(body.aspect_uploads).toBeUndefined()
  })

  it('returns the aspect error on an already-claimed order instead of signing a bad path', async () => {
    claimed({ remotion: { template: 'list', props: {}, aspects: ['21:9'] } })
    const response = await POST(claimRequest({ worker_id: 'mac-a' }))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.claimed).toBe(true)
    expect(body.aspect_error).toContain('21:9')
    expect(body.aspect_uploads).toBeUndefined()
    expect(signMock).toHaveBeenCalledTimes(3)
  })
})
