import { describe, expect, it } from 'vitest'
import { readBoundedJson } from '../bounded-body'

function req(body: string, headers: Record<string, string> = {}): Request {
  return new Request('https://example.test/x', { method: 'POST', body, headers })
}

/** A request whose declared Content-Length is absent or understates the real body (streamed cap must still catch it). */
function streamedReq(body: string): Request {
  const bytes = new TextEncoder().encode(body)
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
  return new Request('https://example.test/x', { method: 'POST', body: stream, duplex: 'half' } as RequestInit)
}

describe('readBoundedJson', () => {
  it('parses a small JSON body', async () => {
    const res = await readBoundedJson(req(JSON.stringify({ a: 1 })), 1000)
    expect(res).toEqual({ ok: true, value: { a: 1 } })
  })

  it('rejects when the declared Content-Length already exceeds the cap (never reads the body)', async () => {
    const res = await readBoundedJson(req('x'.repeat(10), { 'content-length': '999999' }), 16)
    expect(res).toEqual({ ok: false, reason: 'too_large' })
  })

  it('rejects when the streamed body exceeds the cap even without a declared/accurate Content-Length', async () => {
    const big = JSON.stringify({ a: 'x'.repeat(100) })
    const res = await readBoundedJson(streamedReq(big), 16)
    expect(res).toEqual({ ok: false, reason: 'too_large' })
  })

  it('empty body → empty', async () => {
    const res = await readBoundedJson(req(''), 1000)
    expect(res).toEqual({ ok: false, reason: 'empty' })
  })

  it('malformed JSON → invalid_json', async () => {
    const res = await readBoundedJson(req('{not json'), 1000)
    expect(res).toEqual({ ok: false, reason: 'invalid_json' })
  })

  it('a JSON array or primitive is returned as-is (object-shape policy is the caller\'s job)', async () => {
    const res = await readBoundedJson(req(JSON.stringify([1, 2, 3])), 1000)
    expect(res).toEqual({ ok: true, value: [1, 2, 3] })
  })
})
