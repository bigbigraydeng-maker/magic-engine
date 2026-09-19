import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { askCopyJudge, CopyJudgeError } from './copy-judge-client'

const Q = { cliche: { instructions: 'uses clichés' } }

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('askCopyJudge', () => {
  const original = process.env.TYPESAFE_API_KEY
  beforeEach(() => { process.env.TYPESAFE_API_KEY = 'test-key' })
  afterEach(() => { process.env.TYPESAFE_API_KEY = original })

  it('throws when the API key is missing (caller fails closed)', async () => {
    delete process.env.TYPESAFE_API_KEY
    const fetchImpl = vi.fn()
    await expect(askCopyJudge({ post: 'x' }, Q, { fetchImpl })).rejects.toBeInstanceOf(CopyJudgeError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('sends noul questions with bearer auth and returns probabilities', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ answers: { cliche: { noul: 0.88 } } }))
    const out = await askCopyJudge({ post: 'Unlock the power' }, Q, { fetchImpl })
    expect(out).toEqual({ cliche: 0.88 })
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key')
    const body = JSON.parse(init.body as string)
    expect(body.questions.cliche).toEqual({ type: 'noul', instructions: 'uses clichés' })
    expect(body.state).toEqual({ post: 'Unlock the power' })
  })

  it('throws on non-2xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'rate' }, 429))
    await expect(askCopyJudge({}, Q, { fetchImpl })).rejects.toThrow('HTTP 429')
  })

  it('throws on network error', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    await expect(askCopyJudge({}, Q, { fetchImpl })).rejects.toThrow('ECONNRESET')
  })

  it('throws when an asked question has no valid answer', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ answers: { cliche: { noul: 'high' } } }))
    await expect(askCopyJudge({}, Q, { fetchImpl })).rejects.toThrow('no valid answer')
  })

  it('hard deadline fires even if fetch ignores the abort signal', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => new Promise(() => {}))
    const t0 = Date.now()
    await expect(askCopyJudge({}, Q, { fetchImpl, timeoutMs: 500 })).rejects.toThrow('timed out')
    expect(Date.now() - t0).toBeLessThan(2000)
  })
})
