import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { confirmBreakerPauseCard, issueBreakerPauseCard } from '../breaker-card'

const NOW = new Date('2026-11-09T01:00:00.000Z')
const FINGERPRINT = 'a'.repeat(64)

function hold(over: Record<string, unknown> = {}) {
  return {
    id: 'hold-1',
    payload: {
      breaker: true,
      status: 'holding',
      cardRunId: 'run-1',
      fingerprint: FINGERPRINT,
      adsetId: 'set-a',
      campaignId: 'camp-a',
      adAccountId: 'act-demo',
      issuedAt: NOW.toISOString(),
      wrote: false,
      ...over,
    },
  }
}

function sb(rows: unknown[]): SupabaseClient {
  return {
    from() {
      const api = {
        select: () => api,
        eq: () => api,
        limit: async () => ({ data: rows, error: null }),
        update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
        insert: async () => ({ error: null }),
      }
      return api
    },
  } as unknown as SupabaseClient
}

describe('breaker pause-ad-set card', () => {
  it('已有未点的暂停卡时不再出第二张', async () => {
    const issued = await issueBreakerPauseCard(sb([{ id: 'open', payload: { status: 'holding' } }]), 'client-1', {
      adsetId: 'set-a', campaignId: 'camp-a', accountId: 'act-demo', name: '春季组',
    }, NOW)
    expect(issued).toEqual({ ok: false, reason: 'pending' })
  })

  it('过了当天新西兰 23:59，或三天条件已不成立，都不去暂停', async () => {
    const execute = vi.fn()
    const expired = await confirmBreakerPauseCard({
      sb: sb([hold({ issuedAt: '2026-11-07T00:00:00.000Z' })]),
      clientId: 'client-1',
      runId: 'run-1',
      fingerprint: FINGERPRINT,
      resolution: 'confirm',
      now: NOW,
      execute,
    })
    expect(expired.wrote).toBe(false)
    expect(expired.reason).toContain('23:59')
    const cleared = await confirmBreakerPauseCard({
      sb: sb([hold()]),
      clientId: 'client-1',
      runId: 'run-1',
      fingerprint: FINGERPRINT,
      resolution: 'confirm',
      now: NOW,
      recheck: async () => '按最新数字，这条建议已经不成立，没有改广告。',
      execute,
    })
    expect(cleared.wrote).toBe(false)
    expect(cleared.reason).toContain('不成立')
    expect(execute).not.toHaveBeenCalled()
  })

  it('三天条件还在时才把暂停交给原有的暂停动作', async () => {
    const execute = vi.fn(async () => ({ kind: 'paused' as const, before: 'ACTIVE', after: 'PAUSED', runId: 'k1', reason: '已暂停。' }))
    const decided = await confirmBreakerPauseCard({
      sb: sb([hold()]),
      clientId: 'client-1',
      runId: 'run-1',
      fingerprint: FINGERPRINT,
      resolution: 'confirm',
      now: NOW,
      recheck: async () => null,
      decide: async () => 'confirmed',
      execute,
    })
    expect(decided.wrote).toBe(true)
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ adsetId: 'set-a', accountId: 'act-demo' }))
  })

  it('点不做只记下选择，不去暂停', async () => {
    const execute = vi.fn()
    const decide = vi.fn(async () => 'declined' as const)
    const declined = await confirmBreakerPauseCard({
      sb: sb([hold()]),
      clientId: 'client-1',
      runId: 'run-1',
      fingerprint: FINGERPRINT,
      resolution: 'decline',
      now: NOW,
      decide,
      execute,
    })
    expect(declined.wrote).toBe(false)
    expect(declined.reason).toBe('没有暂停。')
    expect(decide).toHaveBeenCalledOnce()
    expect(execute).not.toHaveBeenCalled()
  })

  it('发卡和确认都不直接改广告', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/ads-pause-card/breaker-card.ts'), 'utf8')
    expect(source).not.toContain('setAdSetStatus')
    expect(source).not.toContain('graph.facebook')
  })
})
