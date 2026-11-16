import { describe, expect, it } from 'vitest'
import { processRawEvent } from '../voipline/process'
import { harness, inboundEnded, inboundStart } from '../voipline/__tests__/fixtures'
import { directFallbackEnabled, runDirectTelephonySweep } from '../direct-sweep'
import type { SweepCandidate, SweepDeps } from '@/lib/inngest/functions/telephony-analysis'

const LATER = new Date('2026-10-12T03:00:00.000Z')
const noAnalysis: SweepDeps = { listEnabledConnections: async () => [], listCalls: async () => [] }

describe('电话进 CRM：Inngest 停了，直接补处理', () => {
  it('webhook 存了原始事件但没人处理 → 补处理一轮后写进 CRM，只写一条', async () => {
    const h = harness()
    await h.send(inboundStart())
    await h.send(inboundEnded())
    h.emitted.length = 0 // Inngest never ran these
    const r = await runDirectTelephonySweep({
      store: h.mem.store,
      processRaw: (id) => processRawEvent(h.mem.store, id, h.now, { quietMs: 0 }),
      analysisDeps: noAnalysis,
      analyse: async () => ({ status: 'done' }),
      now: LATER,
    })
    expect(r.status).toBe('done')
    expect(r.crm?.rawRedispatched).toBe(2)
    expect(r.crm?.processFailed).toBe(0)
    expect([...h.mem.touchpoints.values()]).toHaveLength(1)
    expect([...h.mem.raw.values()].every((x) => x.status === 'processed')).toBe(true)

    // second round: nothing left, nothing written twice
    const again = await runDirectTelephonySweep({
      store: h.mem.store,
      processRaw: (id) => processRawEvent(h.mem.store, id, h.now, { quietMs: 0 }),
      analysisDeps: noAnalysis,
      analyse: async () => ({ status: 'done' }),
      now: LATER,
    })
    expect(again.crm?.rawRedispatched).toBe(0)
    expect([...h.mem.touchpoints.values()]).toHaveLength(1)
  })

  it('一条处理失败不挡后面的，失败原因留在回执里', async () => {
    const h = harness()
    await h.send(inboundStart())
    await h.send(inboundEnded())
    let calls = 0
    const r = await runDirectTelephonySweep({
      store: h.mem.store,
      processRaw: async (id) => {
        calls++
        if (calls === 1) throw new Error('boom')
        return processRawEvent(h.mem.store, id, h.now, { quietMs: 0 })
      },
      analysisDeps: noAnalysis,
      analyse: async () => ({ status: 'done' }),
      now: LATER,
    })
    expect(calls).toBe(2)
    expect(r.crm?.processFailed).toBe(1)
    expect(r.crm?.firstError).toBe('boom')
  })

  it('通话分析：逐条跑，一条失败不挡后面，按结果计数', async () => {
    const h = harness()
    const cands: SweepCandidate[] = [
      { client_id: 'c', provider: 'twilio', provider_call_id: 'a' },
      { client_id: 'c', provider: 'twilio', provider_call_id: 'b' },
      { client_id: 'c', provider: 'twilio', provider_call_id: 'c' },
    ]
    const seen: string[] = []
    const r = await runDirectTelephonySweep({
      store: h.mem.store,
      processRaw: async () => undefined,
      analysisDeps: {
        listEnabledConnections: async () => [{ id: 'conn', analysis_enabled_at: '2026-10-01T00:00:00Z' }],
        listCalls: async () => cands,
      },
      analyse: async (c) => {
        seen.push(c.provider_call_id)
        if (c.provider_call_id === 'b') throw new Error('transcribe down')
        return { status: 'done' }
      },
      now: LATER,
    })
    expect(seen).toEqual(['a', 'b', 'c'])
    expect(r.analysis).toEqual({ candidates: 3, byStatus: { done: 2 }, failed: 1, firstError: 'transcribe down' })
  })

  it('分析那半还在跑时，下一轮照样把新电话写进 CRM，只跳过分析', async () => {
    const h = harness()
    let release: () => void = () => undefined
    const gate = new Promise<void>((res) => { release = res })
    const first = runDirectTelephonySweep({
      store: h.mem.store,
      processRaw: async () => undefined,
      analysisDeps: { listEnabledConnections: async () => { await gate; return [] }, listCalls: async () => [] },
      analyse: async () => ({ status: 'done' }),
      now: LATER,
    })
    await new Promise((r) => setTimeout(r, 0))
    await h.send(inboundStart())
    await h.send(inboundEnded())
    const second = await runDirectTelephonySweep({
      store: h.mem.store,
      processRaw: (id) => processRawEvent(h.mem.store, id, h.now, { quietMs: 0 }),
      analysisDeps: noAnalysis,
      analyse: async () => ({ status: 'done' }),
      now: LATER,
    })
    expect(second.status).toBe('done')
    expect(second.crm?.rawRedispatched).toBe(2)
    expect(second.analysis).toBeNull()
    expect([...h.mem.touchpoints.values()]).toHaveLength(1)
    release()
    expect((await first).status).toBe('done')
  })

  it('开关：只有明写 off 才关', () => {
    expect(directFallbackEnabled({})).toBe(true)
    expect(directFallbackEnabled({ INNGEST_DIRECT_FALLBACK: ' OFF ' })).toBe(false)
    expect(directFallbackEnabled({ INNGEST_DIRECT_FALLBACK: 'on' })).toBe(true)
  })
})
