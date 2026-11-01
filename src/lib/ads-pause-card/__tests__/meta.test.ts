import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMetaPauseRuntime } from '../meta'
import type { PauseOrder } from '../order'

const order: PauseOrder = {
  sourceKind: 'prescription',
  sourceId: 'rx-1',
  stepId: 'step-1',
  level: 'ad_set',
  adAccountId: '42',
  campaignId: '100',
  adsetId: '200',
  adId: null,
  basis: '这个广告组的素材已经换掉',
  expectedMetric: 'ads.account.cost_per_lead',
  successorAdId: '400',
}

function json(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response
}

afterEach(() => { vi.unstubAllGlobals() })

describe('meta pause runtime', () => {
  it('sends only a pause and reads the status back', async () => {
    const bodies: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        bodies.push(String(init.body))
        return json({ success: true })
      }
      if (String(url).includes('/ads?')) return json({ data: [{ id: '300', adset_id: '200', effective_status: 'ACTIVE' }] })
      if (String(url).includes('/400')) return json({ effective_status: 'ACTIVE' })
      if (String(url).includes('fields=status')) return json({ status: 'PAUSED' })
      return json({ account_id: '42', campaign_id: '100' })
    }))
    const runtime = createMetaPauseRuntime('token', async () => ({ ids: ['42'] }))
    const live = await runtime.live(order)
    expect(live.object?.campaignId).toBe('100')
    expect(live.successorEffectiveStatus).toBe('ACTIVE')
    expect(await runtime.pause(order)).toBe(true)
    expect(bodies.some((body) => body.includes('PAUSED'))).toBe(true)
    expect(bodies.some((body) => body.includes('ACTIVE'))).toBe(false)
    expect(await runtime.readback(order)).toBe('PAUSED')
  })
})
