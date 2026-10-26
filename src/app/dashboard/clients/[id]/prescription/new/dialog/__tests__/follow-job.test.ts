import { describe, expect, it } from 'vitest'
import { followPrescriptionJob } from '../follow-job'

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
    const result = await followPrescriptionJob(sse([
      { type: 'started', prescription_id: 'p1' },
      { type: 'progress', note: '正在写' },
      { type: 'done', prescription_id: 'p1', content },
    ]), 'c1')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.content.summary).toBe('先改落地页')
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

  it('surfaces a stream error without dumping the payload', async () => {
    const result = await followPrescriptionJob(sse([
      { type: 'error', error: '诸葛亮流意外关闭' },
    ]), 'c1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('诸葛亮')
  })
})
