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

function owned(status: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status,
    activation: { card_run_id: CARD, status: status === 'active' ? 'executed' : 'meta_failed' },
    ...extra,
  }
}

function fakeDb(payload: Record<string, unknown>, afterRead?: Record<string, unknown>) {
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
                    maybeSingle: async () => {
                      const seen = structuredClone(store.payload)
                      if (afterRead) store.payload = structuredClone(afterRead)
                      return { data: { payload: seen }, error: null }
                    },
                  }
                },
              }
            },
          }
        },
        update(row: { payload: Record<string, unknown> }) {
          const filters: Record<string, string> = {}
          const chain = {
            eq(column: string, value: string) {
              filters[column] = value
              return chain
            },
            select() {
              const activation = store.payload.activation
              const card = activation && typeof activation === 'object' && !Array.isArray(activation)
                ? (activation as { card_run_id?: unknown }).card_run_id
                : undefined
              const matches = filters.id === 'draft-1'
                && filters.client_id === 'client-1'
                && filters['payload->>status'] === store.payload.status
                && filters['payload->activation->>card_run_id'] === card
              if (!matches) return Promise.resolve({ data: [], error: null })
              store.payload = row.payload
              return Promise.resolve({ data: [{ id: 'draft-1' }], error: null })
            },
          }
          return chain
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
    const { sb, store } = fakeDb(owned('active', { error: '旧原因' }))
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
    expect(result.note).toBeNull()
    const activation = store.payload.activation as { card_run_id?: string }
    expect(activation.card_run_id).toBe(CARD)
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
    const { sb, store } = fakeDb(owned('active'))
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
    expect(result.note).toBeNull()
  })

  it('does not pause after a non-retryable claim failure', async () => {
    m.approveDraft.mockResolvedValue({ ok: false, error: '占不到这条草案' })
    m.fetchCampaignStatus.mockResolvedValue('PAUSED')
    const { sb, store } = fakeDb({ status: 'awaiting_approval' })
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
    expect(store.payload).toEqual({ status: 'awaiting_approval' })
  })

  it('does not pause when the retry loses the claim', async () => {
    m.approveDraft
      .mockResolvedValueOnce({ ok: false, error: '开 广告没打开' })
      .mockResolvedValueOnce({ ok: false, error: '这条刚被别处处理过，这次没有再开。' })
    m.fetchCampaignStatus.mockResolvedValue(null)
    const { sb } = fakeDb({ status: 'awaiting_approval' })
    const result = await executeConfirmedGoLive({
      supabase: sb as never,
      clientId: 'client-1',
      draftId: 'draft-1',
      authority: authority(),
      ids: IDS,
    })
    expect(result.settle).toMatchObject({ outcome: 'held', paused: false })
    expect(m.approveDraft).toHaveBeenCalledTimes(2)
    expect(m.activatePublished).not.toHaveBeenCalled()
    expect(m.pausePublished).not.toHaveBeenCalled()
  })

  it('does not write a rejection back to waiting', async () => {
    m.fetchCampaignStatus.mockResolvedValue('PAUSED')
    const waiting = owned('awaiting_approval')
    const rejected = { ...structuredClone(waiting), status: 'rejected', error: '先不投' }
    const { sb, store } = fakeDb(waiting, rejected)
    const result = await executeConfirmedGoLive({
      supabase: sb as never,
      clientId: 'client-1',
      draftId: 'draft-1',
      authority: authority(),
      ids: IDS,
    })
    expect(store.payload.status).toBe('rejected')
    expect(store.payload.goLiveHeld).toBeUndefined()
    expect(store.payload.error).toBe('先不投')
    expect(result.note).toContain('账本没写上')
  })

  it('does not overwrite another run that already recorded the open', async () => {
    const winner = {
      status: 'active',
      activation: {
        card_run_id: '22222222-2222-4222-8222-222222222222',
        status: 'executed',
        marker: 'winner',
      },
      goLiveStartedAt: '2026-10-28T02:00:00.000Z',
    }
    const { sb, store } = fakeDb(owned('active'), winner)
    const result = await executeConfirmedGoLive({
      supabase: sb as never,
      clientId: 'client-1',
      draftId: 'draft-1',
      authority: authority(),
      ids: IDS,
      now: new Date('2026-10-28T01:00:00.000Z'),
    })
    expect(store.payload).toEqual(winner)
    expect(result.note).toContain('开投观察的开始时间没写上')
  })
})
