/**
 * Winner cards write only after confirm, and only once.
 * No live Meta calls. Ids here are short fakes.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { confirmWinnerCard, refuseSingleAdPause, type ConfirmWinnerInput, type WinnerPorts } from '../winner-reel-execute'
import type { ProposalHold } from '@/lib/winner-reel-sync/intents'
import { pausedDraftClickUrl } from '@/lib/ads-strategy/paused-draft-copy'
import { WINNER_ADD_WHAT, WINNER_PAUSE_WHAT, WINNER_ACTIVATE_WHAT } from '@/lib/winner-reel-sync/copy'

const FP = 'a'.repeat(64)
const CLIENT = 'client-1'
const RUN = 'run-1'

function hold(over: Partial<ProposalHold> = {}): ProposalHold {
  return {
    kind: 'add_paused', status: 'holding', cardRunId: RUN, subjectKey: 'winner-add:abc',
    fingerprint: FP, metric: 'ads.account.ctr', direction: 'up', observationWindowDays: 7,
    before: 9, after: null, writeAttempted: false, wroteMeta: false, readback: null,
    confirmedBy: null, configAskedActive: true, postId: 'post-1', pageId: 'page-1',
    adAccountId: 'act_11', adsetId: '301', adId: null, name: '爆款暂停稿', score: 9, ctr: null,
    ...over,
  }
}

function db(row: { id: string; payload: ProposalHold }) {
  const rows = [{ id: row.id, client_id: CLIENT, action_type: 'ads.winner_reel_proposal', payload: row.payload }]
  return {
    rows,
    client: {
      from() {
        const filters: Array<[string, string]> = []
        let patch: { payload?: ProposalHold } | null = null
        const api = {
          select: () => api,
          eq(col: string, val: string) { filters.push([col, val]); return api },
          update(next: { payload: ProposalHold }) { patch = next; return api },
          maybeSingle: () => Promise.resolve(finish()),
          then: (resolve: (value: { data: unknown; error: null }) => unknown) => Promise.resolve(finish()).then(resolve),
        }
        function finish() {
          const matched = rows.filter((item) => filters.every(([col, val]) => matches(item, col, val)))
          if (!patch?.payload) return { data: matched.map((item) => ({ id: item.id, payload: item.payload })), error: null }
          const one = matched.length === 1 ? matched[0] : null
          if (!one) return { data: null, error: null }
          one.payload = patch.payload
          return { data: { id: one.id }, error: null }
        }
        return api
      },
    } as unknown as SupabaseClient,
  }
}

function matches(row: { id: string; client_id: string; action_type: string; payload: ProposalHold }, col: string, val: string): boolean {
  if (col === 'id') return row.id === val
  if (col === 'client_id') return row.client_id === val
  if (col === 'action_type') return row.action_type === val
  if (col === 'payload->>status') return row.payload.status === val
  if (col === 'payload->>cardRunId') return row.payload.cardRunId === val
  return false
}

const view = {
  runId: RUN, expectedDecisionId: '11111111-1111-1111-1111-111111111111', fingerprint: FP,
  what: WINNER_ADD_WHAT, account: '这位客户的广告账户', amount: '不花钱', date: '确认之后才建',
  scope: '加进已有广告组', expiresLabel: '很快过期', status: 'confirmed' as const,
  statusLine: '记下了', confirmEnabled: false, declineEnabled: false, blockedReason: null,
}

function input(over: Partial<ConfirmWinnerInput> = {}): ConfirmWinnerInput {
  return {
    clientId: CLIENT, runId: RUN, decisionId: view.expectedDecisionId, fingerprint: FP,
    choice: 'confirm', clicker: { kind: 'opc', email: 'ray@example.com' },
    actor: { triggeredBy: 'person', triggeredByRef: 'session-user' },
    ...over,
  }
}

const paused = { adId: '101', status: 'PAUSED', accountId: '11', campaignId: '201', adsetId: '301' }

function ports(over: Partial<WinnerPorts> = {}): WinnerPorts {
  return {
    decide: vi.fn(async () => view),
    recheck: vi.fn(async () => ({
      status: 'ok' as const, postsScanned: 1, winnersFound: 1, guardsHit: [],
      adds: [{ postId: 'post-1', name: '爆款暂停稿', score: 9, pageId: 'page-1', adAccountId: 'act_11', adsetId: '301' }],
      pauses: [{ adId: '101', name: '弱的', reason: '低', ctr: 0.1, pageId: 'page-1', adAccountId: 'act_11', adsetId: '301' }],
      configAskedActive: true, slackWebhookUrl: null,
    })),
    token: vi.fn(async () => 'token'),
    createPaused: vi.fn(async () => ({ adId: '101' })),
    readPlacement: vi.fn(async () => paused),
    activate: vi.fn(async () => true),
    link: vi.fn(async () => ({ creativeRef: 'piece-1' })),
    kernel: vi.fn(),
    issuePause: vi.fn(),
    submitPause: vi.fn(),
    pauseRuntime: vi.fn(async () => ({ live: vi.fn(), pause: vi.fn(), readback: vi.fn() })),
    proposeLive: vi.fn(async () => 'live-1'),
    ...over,
  }
}

describe('winner card confirm', () => {
  it('a row stuck writing is not written again', async () => {
    const store = db({ id: 'row-1', payload: hold({ status: 'writing', writeAttempted: true }) })
    const used = ports()
    const result = await confirmWinnerCard(store.client, input(), used)
    expect(result.resultLine).toContain('没有再自动写一次')
    expect(used.createPaused).not.toHaveBeenCalled()
    expect(used.decide).not.toHaveBeenCalled()
    expect(used.activate).not.toHaveBeenCalled()
  })

  it('a suggestion that no longer matches is not created', async () => {
    const store = db({ id: 'row-1', payload: hold() })
    const used = ports({ recheck: vi.fn(async () => ({
      status: 'ok' as const, postsScanned: 1, winnersFound: 0, guardsHit: [],
      adds: [], pauses: [], configAskedActive: false, slackWebhookUrl: null,
    })) })
    await expect(confirmWinnerCard(store.client, input(), used)).rejects.toThrow(/对不上/)
    expect(used.createPaused).not.toHaveBeenCalled()
    expect(used.decide).not.toHaveBeenCalled()
  })

  it('creates one paused ad and does not write again when the read-back differs', async () => {
    const store = db({ id: 'row-1', payload: hold() })
    const used = ports({ readPlacement: vi.fn(async () => ({ ...paused, status: 'ACTIVE' })) })
    const result = await confirmWinnerCard(store.client, input(), used)
    expect(used.createPaused).toHaveBeenCalledTimes(1)
    expect(used.createPaused).toHaveBeenCalledWith(expect.objectContaining({ status: 'PAUSED' }))
    expect(used.activate).not.toHaveBeenCalled()
    expect(result.wroteMeta).toBe(true)
    expect(result.resultLine).toContain('没有再改一次')
    expect(store.rows[0]?.payload.status).toBe('failed')
  })

  it('links the creative only after a paused create, and opens a separate live card', async () => {
    const store = db({ id: 'row-1', payload: hold() })
    const used = ports()
    const result = await confirmWinnerCard(store.client, input(), used)
    expect(result.resultLine).toContain('已建成暂停广告')
    expect(used.link).toHaveBeenCalledWith(expect.objectContaining({
      clientId: CLIENT, adId: '101', postId: 'post-1', pageId: 'page-1', createdBy: 'winner_reel_sync',
    }))
    expect(used.proposeLive).toHaveBeenCalledTimes(1)
    expect(used.activate).not.toHaveBeenCalled()
    const saved = store.rows[0]?.payload
    expect(saved?.confirmedBy).toBe('session-user')
    expect(saved?.metric).toBe('ads.account.ctr')
    expect(saved?.direction).toBe('up')
    expect(saved?.observationWindowDays).toBe(7)
    expect(saved?.before).toBe(9)
    expect(saved?.after).toBeNull()
    expect(saved?.status).toBe('executed')
  })

  it('a pause suggestion goes through the pause card and does not pause by itself', async () => {
    const pause = vi.fn()
    const store = db({ id: 'row-1', payload: hold({ kind: 'pause_ad', postId: null, adId: '101', score: null, ctr: 0.1, before: 0.1 }) })
    const used = ports({
      pauseRuntime: vi.fn(async () => ({ live: vi.fn(), pause, readback: vi.fn() })),
      issuePause: vi.fn(async () => ({
        status: 'issued' as const, confirmEnabled: true, runId: 'pause-run', fingerprint: FP,
        expectedDecisionId: view.expectedDecisionId,
      })),
      submitPause: vi.fn(async () => ({ status: 'executed', reason: '已暂停。', wroteMeta: true, readback: 'PAUSED' })),
    })
    const result = await confirmWinnerCard(store.client, input(), used)
    expect(used.issuePause).toHaveBeenCalledTimes(1)
    expect(used.submitPause).toHaveBeenCalledTimes(1)
    expect(pause).not.toHaveBeenCalled()
    expect(used.createPaused).not.toHaveBeenCalled()
    expect(result.wroteMeta).toBe(true)
    expect(store.rows[0]?.payload.confirmedBy).toBe('session-user')
  })

  it('refuses a single-ad pause because the live pause card only pauses an ad set', async () => {
    const store = db({ id: 'row-1', payload: hold({ kind: 'pause_ad', postId: null, adId: '101', score: null, ctr: 0.1, before: 0.1 }) })
    const used = ports({ issuePause: vi.fn(async () => refuseSingleAdPause()) })
    const result = await confirmWinnerCard(store.client, input(), used)
    expect(used.submitPause).not.toHaveBeenCalled()
    expect(used.createPaused).not.toHaveBeenCalled()
    expect(used.activate).not.toHaveBeenCalled()
    expect(result.wroteMeta).toBe(false)
    expect(result.resultLine).toContain('没有暂停')
    expect(store.rows[0]?.payload.status).toBe('failed')
  })

  it('does not pause when the pause card is off or still needs an empty-campaign confirmation', async () => {
    const pause = vi.fn()
    const off = db({ id: 'row-1', payload: hold({ kind: 'pause_ad', postId: null, adId: '101', score: null, ctr: 0.1 }) })
    const offPorts = ports({
      pauseRuntime: vi.fn(async () => ({ live: vi.fn(), pause, readback: vi.fn() })),
      issuePause: vi.fn(async () => ({ status: 'off' as const, reason: '这个客户没开暂停广告的确认卡。' })),
    })
    const offResult = await confirmWinnerCard(off.client, input(), offPorts)
    expect(offPorts.submitPause).not.toHaveBeenCalled()
    expect(pause).not.toHaveBeenCalled()
    expect(offResult.wroteMeta).toBe(false)

    const empty = db({ id: 'row-2', payload: hold({ kind: 'pause_ad', postId: null, adId: '101', score: null, ctr: 0.1 }) })
    const emptyPorts = ports({
      issuePause: vi.fn(async () => ({ status: 'blocked' as const, confirmEnabled: false, emptyAckRunId: 'ack-1', reason: '要单独确认' })),
    })
    const emptyResult = await confirmWinnerCard(empty.client, input(), emptyPorts)
    expect(emptyPorts.submitPause).not.toHaveBeenCalled()
    expect(emptyResult.wroteMeta).toBe(false)
    expect(emptyResult.resultLine).toContain('没有暂停')
  })

  it('turns one paused ad on once, and does not try again when the read-back is still paused', async () => {
    const store = db({ id: 'row-1', payload: hold({ kind: 'activate', postId: null, adId: '101', score: null }) })
    const used = ports({
      readPlacement: vi.fn()
        .mockResolvedValueOnce(paused)
        .mockResolvedValueOnce(paused)
        .mockResolvedValueOnce(paused),
    })
    const result = await confirmWinnerCard(store.client, input(), used)
    expect(used.activate).toHaveBeenCalledTimes(1)
    expect(result.resultLine).toContain('没有再改一次')
    expect(store.rows[0]?.payload.status).toBe('failed')
  })
})

describe('winner card click target', () => {
  it('sends the three winner titles to the winner route', () => {
    for (const what of [WINNER_ADD_WHAT, WINNER_PAUSE_WHAT, WINNER_ACTIVATE_WHAT]) {
      expect(pausedDraftClickUrl('client-1', 'run-1', what)).toBe('/api/clients/client-1/meta-ads/winner-reel-cards/run-1')
    }
  })

  it('the human marker stays in the session file', () => {
    const confirm = readFileSync(join(process.cwd(), 'src/lib/action-submission/winner-reel-confirm.ts'), 'utf8')
    const execute = readFileSync(join(process.cwd(), 'src/lib/action-submission/winner-reel-execute.ts'), 'utf8')
    expect(confirm).toContain("triggeredBy: 'human'")
    expect(confirm).toContain('requirePaidClientAccess(')
    expect(execute).not.toContain("triggeredBy: 'human'")
    expect(execute).not.toContain('ads-pause-card/flow')
    expect(execute).not.toContain('ads-pause-card/meta')
    expect(execute).not.toContain('pauseAd')
  })
})
