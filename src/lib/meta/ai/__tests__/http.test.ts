// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { boundedBody } from '../http'
import { MetaReadError } from '../../graph-read'

function req(body: string, headers: Record<string, string> = {}): Request {
  return new Request('https://app.example/x', { method: 'POST', body, headers })
}

describe('boundedBody', () => {
  it('parses a normal JSON body', async () => {
    await expect(boundedBody(req(JSON.stringify({ tool: 'x', arguments: {} })))).resolves.toEqual({ tool: 'x', arguments: {} })
  })

  it('over 24000 bytes → request_too_large (413), same as before the shared read primitive', async () => {
    const big = JSON.stringify({ a: 'x'.repeat(25000) })
    await expect(boundedBody(req(big))).rejects.toMatchObject({ code: 'request_too_large', status: 413 } as Partial<MetaReadError>)
  })

  it('a lying small Content-Length does not let an oversized streamed body through', async () => {
    const big = JSON.stringify({ a: 'x'.repeat(25000) })
    await expect(boundedBody(req(big, { 'content-length': '10' }))).rejects.toMatchObject({ code: 'request_too_large' } as Partial<MetaReadError>)
  })

  it('malformed JSON → invalid_json (no status override)', async () => {
    await expect(boundedBody(req('{not json'))).rejects.toMatchObject({ code: 'invalid_json' } as Partial<MetaReadError>)
  })

  it('empty body → invalid_json (matches the pre-refactor behavior: JSON.parse(\'\') throws)', async () => {
    await expect(boundedBody(req(''))).rejects.toMatchObject({ code: 'invalid_json' } as Partial<MetaReadError>)
  })
})
