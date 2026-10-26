/** GET /api/clients/[id]/story-lite — the pack list for the preview page. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GET } from '../../../../app/api/clients/[id]/story-lite/route'

import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { InMemoryLiteStore } from '@/lib/social/story-lite/in-memory-store'
import { createLiteServicePorts } from '@/lib/social/story-lite/ports'
import type { LiteServicePorts } from '@/lib/social/story-lite/service'

vi.mock('@/lib/auth/client-access', () => ({ requireDashboardClientAccess: vi.fn() }))
vi.mock('@/lib/social/story-lite/ports', () => ({ createLiteServicePorts: vi.fn() }))

const CLIENT_ID = '11111111-1111-4111-8111-111111111111'
const USER = { id: '33333333-3333-4333-8333-333333333333', email: 'pm@example.com' }
const ENV_KEYS = ['STORY_AUTO_PUBLISH_LIVE', 'STORY_AUTO_PUBLISH_CLIENTS'] as const

function access(overrides: Record<string, unknown> = {}) {
  return { ok: true, user: USER, role: 'admin', tier: 'admin', allowedClientId: null, ...overrides } as Awaited<
    ReturnType<typeof requireDashboardClientAccess>
  >
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of ENV_KEYS) delete process.env[key]
  const store = new InMemoryLiteStore()
  const ports: LiteServicePorts = {
    store,
    adminEmails: new Set(['pm@example.com']),
    checkFile: async () => 'OK',
    sendEvent: async () => {},
  }
  vi.mocked(createLiteServicePorts).mockReturnValue(ports)
  vi.mocked(requireDashboardClientAccess).mockResolvedValue(access())
})

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key]
})

describe('GET story-lite list', () => {
  it('admin: 200, rehearsal by default (live=false), empty list', async () => {
    const res = await GET(new Request('http://localhost/x'), { params: { id: CLIENT_ID } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, live: false, packs: [] })
  })

  it('live only when both switches are on for this client', async () => {
    process.env.STORY_AUTO_PUBLISH_LIVE = 'true'
    const off = await (await GET(new Request('http://localhost/x'), { params: { id: CLIENT_ID } })).json()
    expect(off.live).toBe(false)
    process.env.STORY_AUTO_PUBLISH_CLIENTS = CLIENT_ID
    const on = await (await GET(new Request('http://localhost/x'), { params: { id: CLIENT_ID } })).json()
    expect(on.live).toBe(true)
  })

  it('a client-limited account is refused (403) and a bad id is 400', async () => {
    vi.mocked(requireDashboardClientAccess).mockResolvedValue(access({ allowedClientId: CLIENT_ID }))
    const limited = await GET(new Request('http://localhost/x'), { params: { id: CLIENT_ID } })
    expect(limited.status).toBe(403)
    const bad = await GET(new Request('http://localhost/x'), { params: { id: 'nope' } })
    expect(bad.status).toBe(400)
  })

  it('not signed in: the access error passes through', async () => {
    vi.mocked(requireDashboardClientAccess).mockResolvedValue({ ok: false, status: 401, error: 'UNAUTHENTICATED' } as Awaited<
      ReturnType<typeof requireDashboardClientAccess>
    >)
    const res = await GET(new Request('http://localhost/x'), { params: { id: CLIENT_ID } })
    expect(res.status).toBe(401)
  })
})
