// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/pm-todo/ai-pickup-waiting-items', () => ({ defaultAiPickupWaitingDeps: { load: vi.fn() } }))
vi.mock('@/lib/crm/ai-takeover/sent-today', () => ({ cataloguesSentToday: vi.fn() }))
vi.mock('@/lib/crm/email-templates/time-zone', () => ({ loadClientTimeZone: vi.fn(async () => 'Pacific/Auckland') }))

import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { cataloguesSentToday } from '@/lib/crm/ai-takeover/sent-today'
import { defaultAiPickupWaitingDeps } from '@/lib/pm-todo/ai-pickup-waiting-items'
import { GET, clearWaitingCache } from './route'

const CLIENT = 'c0000000-0000-4000-8000-000000000001'
const call = (id = CLIENT) => GET(new Request('http://x'), { params: { id } })

beforeEach(() => {
  clearWaitingCache()
  vi.mocked(requirePaidClientAccess).mockReset().mockResolvedValue({ ok: true, user: { email: 'a@b.co' } } as never)
  vi.mocked(defaultAiPickupWaitingDeps.load).mockReset()
  vi.mocked(cataloguesSentToday).mockReset().mockResolvedValue(0)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET ai-pickup/waiting', () => {
  it('no access → the refusal is passed through and nothing is read', async () => {
    vi.mocked(requirePaidClientAccess).mockResolvedValue({ ok: false, status: 403, error: '无权访问' } as never)
    const res = await call()
    expect(res.status).toBe(403)
    expect(defaultAiPickupWaitingDeps.load).not.toHaveBeenCalled()
  })

  it("today's room is the daily batch minus what already went out today, never more than the queue", async () => {
    vi.mocked(defaultAiPickupWaitingDeps.load).mockResolvedValue({ waiting: 200, daysSinceRelease: 13 })
    vi.mocked(cataloguesSentToday).mockResolvedValue(10)
    expect(await (await call()).json()).toEqual({ waiting: 200, readyToday: 20, dailyMax: 30, daysSinceRelease: 13 })
  })

  it("today's batch is out → nothing ready today, though guests still queue", async () => {
    vi.mocked(defaultAiPickupWaitingDeps.load).mockResolvedValue({ waiting: 170, daysSinceRelease: 0 })
    vi.mocked(cataloguesSentToday).mockResolvedValue(30)
    expect((await (await call()).json()).readyToday).toBe(0)
  })

  it('a short queue: ready today is the whole queue', async () => {
    vi.mocked(defaultAiPickupWaitingDeps.load).mockResolvedValue({ waiting: 4, daysSinceRelease: null })
    expect(await (await call()).json()).toEqual({ waiting: 4, readyToday: 4, dailyMax: 30, daysSinceRelease: null })
  })

  it('a client without the list → zeros, not an error', async () => {
    vi.mocked(defaultAiPickupWaitingDeps.load).mockResolvedValue(null)
    expect(await (await call()).json()).toEqual({ waiting: 0, readyToday: 0, dailyMax: 30, daysSinceRelease: null })
  })

  it('the answer is kept per client for a minute; another client is read on its own; access is still checked every time', async () => {
    vi.mocked(defaultAiPickupWaitingDeps.load).mockResolvedValue({ waiting: 5, daysSinceRelease: 1 })
    await call(); await call()
    expect(defaultAiPickupWaitingDeps.load).toHaveBeenCalledTimes(1)
    expect(requirePaidClientAccess).toHaveBeenCalledTimes(2)
    await call('c0000000-0000-4000-8000-000000000002')
    expect(defaultAiPickupWaitingDeps.load).toHaveBeenCalledTimes(2)
    vi.mocked(requirePaidClientAccess).mockResolvedValue({ ok: false, status: 403, error: '无权访问' } as never)
    expect((await call()).status).toBe(403)
  })

  it('a failed read says so in general words and is not kept', async () => {
    vi.mocked(defaultAiPickupWaitingDeps.load).mockRejectedValueOnce(new Error('contacts: secret detail'))
    const res = await call()
    expect(res.status).toBe(503)
    expect(JSON.stringify(await res.json())).not.toContain('secret')
    vi.mocked(defaultAiPickupWaitingDeps.load).mockResolvedValue({ waiting: 1, daysSinceRelease: 0 })
    expect((await call()).status).toBe(200)
  })
})
