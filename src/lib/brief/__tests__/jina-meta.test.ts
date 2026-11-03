import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchUrlWithMeta } from '../jina'

function mockJina(body: unknown, ok = true) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok, status: ok ? 200 : 500, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }))
}

afterEach(() => vi.unstubAllGlobals())

describe('fetchUrlWithMeta', () => {
  it('asks Jina for the JSON envelope and returns the meta description', async () => {
    mockJina({ code: 200, data: { title: 'API Title', description: '  Snippet   text. ', content: '# Heading\n\nbody' } })
    const r = await fetchUrlWithMeta('https://example.com/p')
    const headers = (vi.mocked(fetch).mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers.Accept).toBe('application/json')
    expect(r.description).toBe('Snippet text.')
    expect(r.title).toBe('Heading')
    expect(r.markdown).toContain('body')
  })

  it('returns null description when absent or blank, and falls back to the API title', async () => {
    mockJina({ data: { title: 'API Title', description: '   ', content: 'no heading here' } })
    const r = await fetchUrlWithMeta('https://example.com/p')
    expect(r.description).toBeNull()
    expect(r.title).toBe('API Title')
  })

  it('throws on empty content or non-JSON so the page is recorded as failed', async () => {
    mockJina({ data: { content: '' } })
    await expect(fetchUrlWithMeta('https://example.com/p')).rejects.toThrow('Empty response')
    mockJina('<html>not json</html>')
    await expect(fetchUrlWithMeta('https://example.com/p')).rejects.toThrow('Invalid JSON')
  })
})
