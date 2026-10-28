import { describe, expect, it } from 'vitest'
import { followPrescriptionJob, pollSettled } from '../follow-job'
import { buildEffectJudgmentCard } from '@/lib/ads-strategy/effect-judgment/card'

const content = {
  summary: '先改落地页',
  phases: [],
  kpi_targets: [],
  budget_allocation: [],
}

function sse(events: object[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

describe('followPrescriptionJob', () => {
  it('reads the current stream until the draft is ready', async () => {
    const measure = buildEffectJudgmentCard({
      goal: null, approvedCost: null, approvedCostState: 'missing', prescriptionCosts: [],
      dailyCapCents: null, dailyCapState: 'missing', today: '2026-10-28',
      actualToDate: null, medianCostCents: null, sampleDays: null, loadError: '读不到',
    })
    const result = await followPrescriptionJob(sse([
      { type: 'started', prescription_id: 'p1' },
      { type: 'progress', note: '正在写' },
      { type: 'done', prescription_id: 'p1', content, generation_meta: { measure } },
    ]), 'c1')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.content.summary).toBe('先改落地页')
      expect(result.effectCard).toEqual(measure)
    }
  })

  it('polls after a 202 receipt', async () => {
    const seen: string[] = []
    const fetchImpl = (async (url: string) => {
      seen.push(String(url))
      return Response.json({
        prescription: { status: 'draft', content, progress_note: '写好了', error_message: null, agent_name: 'huatuo' },
      })
    }) as typeof fetch
    const response = new Response(JSON.stringify({ success: true, prescription_id: 'p9', status: 'generating' }), {
      status: 202,
      headers: { 'content-type': 'application/json' },
    })
    const result = await followPrescriptionJob(response, 'c1', {}, fetchImpl, async () => undefined, () => 0)
    expect(seen).toEqual(['/api/clients/c1/prescription/p9'])
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.prescriptionId).toBe('p9')
  })

  it('returns the failure when polling finds a failed prescription', async () => {
    const fetchImpl = (async () => Response.json({
      prescription: { status: 'failed', content: null, error_message: '没写成', progress_note: null },
    })) as typeof fetch
    const result = await pollSettled({
      clientId: 'c1', prescriptionId: 'p7', fetchImpl, sleep: async () => undefined, now: () => 0,
    })
    expect(result).toMatchObject({ ok: false, error: '没写成', prescriptionId: 'p7' })
  })

  it('surfaces a stream error without dumping the payload', async () => {
    const result = await followPrescriptionJob(sse([
      { type: 'error', error: '诸葛亮流意外关闭' },
    ]), 'c1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('诸葛亮')
  })
})
