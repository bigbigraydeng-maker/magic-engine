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

import { parseExecutedLaunches } from '@/lib/ads/prescription-launch-check'
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

function heldFailure(): Record<string, unknown> {
  return {
    status: 'activating',
    campaignId: 'camp',
    activation: {
      card_run_id: CARD,
      status: 'meta_failed',
      error: '开 第一次没开成',
      authorized_at: '2026-10-28T01:00:00.000Z',
    },
  }
}

function pauseThenLive(): void {
  m.fetchCampaignStatus
    .mockResolvedValueOnce('PAUSED')
    .mockResolvedValueOnce('PAUSED')
    .mockResolvedValueOnce('PAUSED')
    .mockResolvedValue('ACTIVE')
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
                    maybeSingle: async () => ({ data: { payload: structuredClone(store.payload) }, error: null }),
                  }
                },
              }
            },
          }
        },
        update(row: { payload: Record<string, unknown> }) {
          const filters: Record<string, string> = {}
          let swapped = false
          const chain = {
            eq(column: string, value: string) {
              filters[column] = value
              return chain
            },
            select() {
              // A competing write lands after the read and before this update.
              if (afterRead && !swapped) {
                store.payload = structuredClone(afterRead)
                swapped = true
              }
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
    const { sb } = fakeDb(owned('active'))
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
    const open = owned('active')
    const rejected = { ...structuredClone(open), status: 'rejected', error: '先不投' }
    const { sb, store } = fakeDb(open, rejected)
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

  it('does not pause when a retryable open fails and another request holds activating', async () => {
    const other = '22222222-2222-4222-8222-222222222222'
    const theirs = {
      status: 'activating',
      activation: { card_run_id: other, status: 'authorized_pending' },
    }
    const { sb, store } = fakeDb(owned('awaiting_approval'))
    m.approveDraft
      .mockResolvedValueOnce({ ok: false, error: '开 第一次没开成', holding: false })
      .mockResolvedValueOnce({ ok: false, error: '开 第二次没开成', holding: false })
    m.fetchCampaignStatus.mockImplementation(async () => {
      store.payload = structuredClone(theirs)
      return 'PAUSED'
    })
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
    expect(store.payload).toEqual(theirs)
    expect(result.note).toContain('账本没写上')
  })

  it('pauses while the claim is still ours and releases it only afterwards', async () => {
    const { sb, store } = fakeDb(owned('awaiting_approval'))
    const seen: string[] = []
    m.approveDraft.mockImplementation(async () => {
      store.payload = owned('activating')
      return { ok: false, error: '开 没开成', holding: true }
    })
    m.activatePublished.mockImplementation(async () => {
      seen.push(String(store.payload.status))
      return { ok: false, error: '开 第二次没开成' }
    })
    m.fetchCampaignStatus.mockResolvedValue('PAUSED')
    m.pausePublished.mockImplementation(async () => {
      seen.push(`pause:${String(store.payload.status)}`)
      return { ok: true, failed: [] }
    })
    const result = await executeConfirmedGoLive({
      supabase: sb as never,
      clientId: 'client-1',
      draftId: 'draft-1',
      authority: authority(),
      ids: IDS,
    })
    expect(result.settle).toMatchObject({ outcome: 'held', paused: true })
    expect(m.approveDraft).toHaveBeenCalledTimes(1)
    expect(m.activatePublished).toHaveBeenCalledTimes(1)
    expect(seen).toEqual(['activating', 'pause:activating'])
    expect(store.payload.status).toBe('awaiting_approval')
    expect(result.note).toBeNull()
  })

  it('records executed after a kept claim retries and the read-back is live', async () => {
    const { sb, store } = fakeDb({ status: 'awaiting_approval' })
    m.approveDraft.mockImplementation(async () => {
      store.payload = heldFailure()
      return { ok: false, error: '开 第一次没开成', holding: true }
    })
    m.activatePublished.mockResolvedValue({ ok: true })
    pauseThenLive()
    const result = await executeConfirmedGoLive({
      supabase: sb as never,
      clientId: 'client-1',
      draftId: 'draft-1',
      authority: authority(),
      ids: IDS,
      now: new Date('2026-10-28T03:00:00.000Z'),
    })
    expect(result.settle).toMatchObject({ outcome: 'live', attempts: 2 })
    expect(m.approveDraft).toHaveBeenCalledTimes(1)
    expect(m.activatePublished).toHaveBeenCalledTimes(1)
    expect(m.pausePublished).not.toHaveBeenCalled()
    const activation = store.payload.activation as Record<string, unknown>
    expect(store.payload.status).toBe('active')
    expect(activation).toMatchObject({
      status: 'executed',
      card_run_id: CARD,
      authorized_at: '2026-10-28T01:00:00.000Z',
    })
    expect(activation.error).toBeUndefined()
    expect(parseExecutedLaunches([{
      id: 'draft-1',
      clientId: 'client-1',
      payload: store.payload,
    }])).toEqual({
      launches: [{
        id: 'draft-1',
        clientId: 'client-1',
        authorizedAt: '2026-10-28T01:00:00.000Z',
        campaignId: 'camp',
      }],
      missingCampaign: 0,
    })
  })

  it('does not mark another run executed when a kept-claim retry reads back live', async () => {
    const winner = {
      status: 'active',
      campaignId: 'camp',
      activation: {
        card_run_id: '22222222-2222-4222-8222-222222222222',
        status: 'executed',
        authorized_at: '2026-10-28T02:00:00.000Z',
        marker: 'winner',
      },
      goLiveStartedAt: '2026-10-28T02:00:00.000Z',
    }
    const { sb, store } = fakeDb({ status: 'awaiting_approval' }, winner)
    m.approveDraft.mockImplementation(async () => {
      store.payload = heldFailure()
      return { ok: false, error: '开 第一次没开成', holding: true }
    })
    m.activatePublished.mockResolvedValue({ ok: true })
    pauseThenLive()
    const result = await executeConfirmedGoLive({
      supabase: sb as never,
      clientId: 'client-1',
      draftId: 'draft-1',
      authority: authority(),
      ids: IDS,
      now: new Date('2026-10-28T03:00:00.000Z'),
    })
    expect(result.settle).toMatchObject({ outcome: 'live', attempts: 2 })
    expect(store.payload).toEqual(winner)
    expect(result.note).toContain('开投观察的开始时间没写上')
    expect(parseExecutedLaunches([{
      id: 'draft-1',
      clientId: 'client-1',
      payload: store.payload,
    }]).launches[0]?.authorizedAt).toBe('2026-10-28T02:00:00.000Z')
  })

  it('does not turn a reused campaign on or off when read-back misses', async () => {
    const ids = { ...IDS, reusedCampaign: true as const }
    m.fetchCampaignStatus.mockResolvedValue('PAUSED')
    const { sb } = fakeDb(owned('active'))
    const result = await executeConfirmedGoLive({
      supabase: sb as never,
      clientId: 'client-1',
      draftId: 'draft-1',
      authority: authority(),
      ids,
    })
    expect(result.settle.outcome).toBe('held')
    expect(m.fetchCampaignStatus.mock.calls.map((call) => call[0])).toEqual(['ad', 'set', 'ad', 'set'])
    expect(m.activatePublished).toHaveBeenCalledTimes(1)
    expect(m.activatePublished).toHaveBeenCalledWith(
      { campaignId: 'camp', adSetId: 'set', adIds: ['ad'] },
      'tok',
      { skipIds: ['camp'] },
    )
    expect(m.pausePublished).toHaveBeenCalledWith(
      { campaignId: 'camp', adSetId: 'set', adIds: ['ad'], reusedCampaign: true },
      'tok',
    )
  })

  it('treats the new ad set as live without reading the reused campaign', async () => {
    const ids = { ...IDS, reusedCampaign: true as const }
    m.fetchCampaignStatus.mockResolvedValue('ACTIVE')
    const { sb } = fakeDb(owned('active'))
    const result = await executeConfirmedGoLive({
      supabase: sb as never,
      clientId: 'client-1',
      draftId: 'draft-1',
      authority: authority(),
      ids,
    })
    expect(result.settle).toMatchObject({ outcome: 'live', attempts: 1 })
    expect(m.fetchCampaignStatus.mock.calls.map((call) => call[0])).toEqual(['ad', 'set'])
    expect(m.activatePublished).not.toHaveBeenCalled()
    expect(m.pausePublished).not.toHaveBeenCalled()
  })

  it('still skips the reused campaign when the retry itself throws', async () => {
    const ids = { ...IDS, reusedCampaign: true as const }
    m.fetchCampaignStatus.mockResolvedValue(null)
    m.activatePublished.mockRejectedValue(new Error('network'))
    const { sb } = fakeDb(owned('activating'))
    const result = await executeConfirmedGoLive({
      supabase: sb as never,
      clientId: 'client-1',
      draftId: 'draft-1',
      authority: authority(),
      ids,
    })
    expect(result.settle).toMatchObject({ outcome: 'held', paused: true })
    expect(m.pausePublished).toHaveBeenCalledWith(
      expect.objectContaining({ reusedCampaign: true, campaignId: 'camp' }),
      'tok',
    )
  })

  it('does not turn a reused ad set or its campaign on or off', async () => {
    const ids = { ...IDS, reusedCampaign: true as const, reusedAdSet: true as const }
    m.fetchCampaignStatus.mockResolvedValue('PAUSED')
    const { sb } = fakeDb(owned('active'))
    const held = await executeConfirmedGoLive({
      supabase: sb as never,
      clientId: 'client-1',
      draftId: 'draft-1',
      authority: authority(),
      ids,
    })
    expect(held.settle.outcome).toBe('held')
    expect(m.fetchCampaignStatus.mock.calls.map((call) => call[0])).toEqual(['ad', 'ad'])
    expect(m.activatePublished).toHaveBeenCalledWith(
      { campaignId: 'camp', adSetId: 'set', adIds: ['ad'] },
      'tok',
      { skipIds: ['camp', 'set'] },
    )
    expect(m.pausePublished).toHaveBeenCalledWith(
      expect.objectContaining({ reusedCampaign: true, reusedAdSet: true }),
      'tok',
    )

    vi.clearAllMocks()
    m.token.mockResolvedValue('tok')
    m.approveDraft.mockResolvedValue({ ok: true })
    m.fetchCampaignStatus.mockResolvedValue('ACTIVE')
    const live = await executeConfirmedGoLive({
      supabase: sb as never,
      clientId: 'client-1',
      draftId: 'draft-1',
      authority: authority(),
      ids,
    })
    expect(live.settle).toMatchObject({ outcome: 'live', attempts: 1 })
    expect(m.fetchCampaignStatus.mock.calls.map((call) => call[0])).toEqual(['ad'])
    expect(m.activatePublished).not.toHaveBeenCalled()
    expect(m.pausePublished).not.toHaveBeenCalled()
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
