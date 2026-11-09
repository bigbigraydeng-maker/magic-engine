import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchAllMock = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn(() => ({})) } }))
vi.mock('@/lib/supabase-paginate', () => ({ fetchAll: (...args: unknown[]) => fetchAllMock(...args) }))

import { loadLatestBriefByContactCached, resetBriefCacheForTests } from '../brief-lookup'

function oneBrief(): void {
  fetchAllMock.mockReset()
  fetchAllMock
    .mockResolvedValueOnce([{ id: 'conv1', contact_id: 'c1' }])
    .mockResolvedValueOnce([
      { conversation_id: 'conv1', intent_level: 'high', next_action: 'call', generated_at: '2026-10-01T00:00:00Z' },
    ])
}

beforeEach(() => {
  resetBriefCacheForTests()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('loadLatestBriefByContactCached', () => {
  it('reads the database once for repeated calls inside the window', async () => {
    oneBrief()
    let t = 1000
    const first = await loadLatestBriefByContactCached('client-a', 30_000, () => t)
    t += 5_000
    const second = await loadLatestBriefByContactCached('client-a', 30_000, () => t)
    expect(first.get('c1')?.intent).toBe('high')
    expect(second.get('c1')?.intent).toBe('high')
    expect(fetchAllMock).toHaveBeenCalledTimes(2) // conversations + briefs, once
  })

  it('reads again after the window has passed', async () => {
    oneBrief()
    let t = 1000
    await loadLatestBriefByContactCached('client-a', 30_000, () => t)
    t += 31_000
    fetchAllMock
      .mockResolvedValueOnce([{ id: 'conv1', contact_id: 'c1' }])
      .mockResolvedValueOnce([])
    const later = await loadLatestBriefByContactCached('client-a', 30_000, () => t)
    expect(fetchAllMock).toHaveBeenCalledTimes(4)
    expect(later.size).toBe(0)
  })

  it('keeps clients apart', async () => {
    oneBrief()
    await loadLatestBriefByContactCached('client-a', 30_000, () => 1000)
    fetchAllMock.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    const other = await loadLatestBriefByContactCached('client-b', 30_000, () => 1000)
    expect(other.size).toBe(0)
    expect(fetchAllMock).toHaveBeenCalledTimes(4)
  })

  it('does not cache a failure: the next call tries again', async () => {
    fetchAllMock.mockReset()
    fetchAllMock.mockRejectedValueOnce(new Error('boom'))
    const failed = await loadLatestBriefByContactCached('client-a', 30_000, () => 1000)
    expect(failed.size).toBe(0)
    fetchAllMock
      .mockResolvedValueOnce([{ id: 'conv1', contact_id: 'c1' }])
      .mockResolvedValueOnce([
        { conversation_id: 'conv1', intent_level: 'low', next_action: null, generated_at: '2026-10-01T00:00:00Z' },
      ])
    const ok = await loadLatestBriefByContactCached('client-a', 30_000, () => 1100)
    expect(ok.get('c1')?.intent).toBe('low')
  })
})
