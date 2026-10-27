import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  approveDraft: vi.fn(),
  activatePublished: vi.fn(),
  pausePublished: vi.fn(),
  fetchCampaignStatus: vi.fn(),
  token: vi.fn(),
}))

vi.mock('@/lib/ads-strategy/draft-and-gate', () => ({ approveDraft: m.approveDraft }))
vi.mock('@/lib/meta/ad-publisher', () => ({
  activatePublished: m.activatePublished,
  pausePublished: m.pausePublished,
}))
vi.mock('@/lib/meta/readback', () => ({ fetchCampaignStatus: m.fetchCampaignStatus }))
vi.mock('@/lib/meta/token-manager', () => ({ getMetaTokenForClient: m.token }))

import { executeConfirmedGoLive } from '../execute'

const IDS = { campaignId: 'camp', adSetId: 'set', adIds: ['ad'] }
const CARD = '11111111-1111-4111-8111-111111111111'

function authority(basis: 'go_live_card' | 'global_admin' = 'go_live_card') {
  return {
    actorUserId: 'user-1',
    actorEmail: 'opc@example.com',
    basis,
    cardRunId: basis === 'go_live_card' ? CARD : undefined,
  }
}

function fakeDb(payload: Record<string, unknown>) {
  const store = { payload }
  const sb = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    maybeSingle: async () => ({ data: { payload: { ...store.payload } }, error: null }),
                  }
                },
              }
            },
          }
        },
        update(row: { payload: Record<string, unknown> }) {
          return {
            eq() {
              return {
                eq: async () => {
                  store.payload = row.payload
                  return { error: null }
                },
              }
            },
          }
        },
      }
    },
  }
  return { sb, store }
}

beforeEach(() => {
  vi.clearAllMocks()
  m.token.mockResolvedValue('tok')
  m.approveDraft.mockResolvedValue({ ok: true })
  m.activatePublished.mockResolvedValue({ ok: true })
  m.pausePublished.mockResolvedValue({ ok: true, failed: [] })
  m.fetchCampaignStatus.mockResolvedValue('ACTIVE')
})

describe('executeConfirmedGoLive', () => {
  it('does not write when the token or the card basis is missing', async () => {
    m.token.mockResolvedValue(null)
    const { sb } = fakeDb({ status: 'awaiting_approval' })
    const missing = await executeConfirmedGoLive({
      supabase: sb as never,
      clientId: 'client-1',
      draftId: 'draft-1',
      authority: authority(),
      ids: IDS,
    })
    expect(missing.settle.outcome).toBe('held')
    expect(m.approveDraft).not.toHaveBeenCalled()

    const wrong = await executeConfirmedGoLive({
      supabase: sb as never,
      clientId: 'client-1',
      draftId: 'draft-1',
      authority: authority('global_admin'),
      ids: IDS,
    })
    expect(wrong.settle.outcome).toBe('held')
    expect(m.token).toHaveBeenCalledTimes(1)
    expect(m.approveDraft).not.toHaveBeenCalled()
  })

  it('marks the draft live after one readback of active and does not pause', async () => {
    const { sb, store } = fakeDb({ status: 'awaiting_approval', error: '旧原因' })
    const result = await executeConfirmedGoLive({
      supabase: sb as never,
      clientId: 'client-1',
      draftId: 'draft-1',
      authority: authority(),
      ids: IDS,
      now: new Date('2026-10-28T01:00:00.000Z'),
    })
    expect(result.settle).toMatchObject({ outcome: 'live', attempts: 1 })
    expect(m.approveDraft).toHaveBeenCalledTimes(1)
    expect(m.approveDraft).toHaveBeenCalledWith('draft-1', sb, 'tok', expect.objectContaining({
      basis: 'go_live_card',
      cardRunId: CARD,
    }), 'go-live-card')
    expect(m.activatePublished).not.toHaveBeenCalled()
    expect(m.pausePublished).not.toHaveBeenCalled()
    expect(store.payload.status).toBe('active')
    expect(store.payload.goLiveStartedAt).toBe('2026-10-28T01:00:00.000Z')
    expect(store.payload.error).toBeUndefined()
  })

  it('retries activate-only once when the first readback is not live', async () => {
    m.fetchCampaignStatus
      .mockResolvedValueOnce('PAUSED')
      .mockResolvedValueOnce('PAUSED')
      .mockResolvedValueOnce('PAUSED')
      .mockResolvedValue('ACTIVE')
    const { sb } = fakeDb({ status: 'awaiting_approval' })
    const result = await executeConfirmedGoLive({
      supabase: sb as never,
      clientId: 'client-1',
      draftId: 'draft-1',
      authority: authority(),
      ids: IDS,
    })
    expect(result.settle).toMatchObject({ outcome: 'live', attempts: 2 })
    expect(m.approveDraft).toHaveBeenCalledTimes(1)
    expect(m.activatePublished).toHaveBeenCalledTimes(1)
    expect(m.pausePublished).not.toHaveBeenCalled()
  })

  it('pauses and keeps the draft waiting when readback stays off', async () => {
    m.fetchCampaignStatus.mockResolvedValue('PAUSED')
    const { sb, store } = fakeDb({ status: 'awaiting_approval' })
    const result = await executeConfirmedGoLive({
      supabase: sb as never,
      clientId: 'client-1',
      draftId: 'draft-1',
      authority: authority(),
      ids: IDS,
    })
    expect(result.settle.outcome).toBe('held')
    expect(m.pausePublished).toHaveBeenCalledTimes(1)
    expect(store.payload.status).toBe('awaiting_approval')
    expect(store.payload.goLiveHeld).toEqual(expect.any(String))
  })

  it('does not pause after a non-retryable claim failure', async () => {
    m.approveDraft.mockResolvedValue({ ok: false, error: '占不到这条草案' })
    m.fetchCampaignStatus.mockResolvedValue('PAUSED')
    const { sb } = fakeDb({ status: 'awaiting_approval' })
    const result = await executeConfirmedGoLive({
      supabase: sb as never,
      clientId: 'client-1',
      draftId: 'draft-1',
      authority: authority(),
      ids: IDS,
    })
    expect(result.settle).toMatchObject({ outcome: 'held' })
    expect(m.activatePublished).not.toHaveBeenCalled()
    expect(m.pausePublished).not.toHaveBeenCalled()
  })
})
