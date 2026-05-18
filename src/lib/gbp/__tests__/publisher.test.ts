/**
 * Unit tests for src/lib/gbp/publisher.ts — GBP post publisher (P8.12.S3.4)
 *
 * Mock strategy: global fetch stubbed. No real HTTP calls.
 * Degradation logic is central — most paths end in draft mode.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { publishToGbp } from '../publisher'

// ─── Fetch mock helpers ───────────────────────────────────────────────────────
// Each helper overrides the per-test spy (set in beforeEach) with a new return value.

function mockFetchOk(body: unknown): void {
  ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => body,
  } as Response)
}

function mockFetchError(status: number): void {
  ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => ({ error: { message: 'API error' } }),
  } as Response)
}

function mockFetchThrow(msg: string): void {
  ;(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error(msg))
}

// ─── Env helpers ──────────────────────────────────────────────────────────────

const LOCATION_NAME = 'accounts/123456789/locations/987654321'
const TOKEN = 'ya29.test-token'

function withToken(): void {
  process.env.GOOGLE_GBP_ACCESS_TOKEN = TOKEN
}

function withoutToken(): void {
  delete process.env.GOOGLE_GBP_ACCESS_TOKEN
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  // Replace global.fetch with a spy each test so we can assert on calls.
  // Using vi.fn() that rejects ensures an accidental fetch call fails loudly.
  global.fetch = vi.fn().mockRejectedValue(new Error('fetch should not be called in this test'))
  withoutToken()
})

afterEach(() => {
  vi.restoreAllMocks()
  withoutToken()
})

// ─── 1. 降级：无 token ─────────────────────────────────────────────────────────

describe('publishToGbp — draft degradation', () => {
  it('returns draft mode when GOOGLE_GBP_ACCESS_TOKEN is not set', async () => {
    const result = await publishToGbp({
      post_text: 'Welcome to our store!',
      location_name: LOCATION_NAME,
    })

    expect(result.mode).toBe('draft')
    expect(result.degradation_reason).toMatch(/access token/i)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('returns draft mode when location_name is not provided even with a token', async () => {
    withToken()

    const result = await publishToGbp({
      post_text: 'Check out our latest deals!',
    })

    expect(result.mode).toBe('draft')
    expect(result.degradation_reason).toMatch(/location/i)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('degrades to draft (does not throw) when API returns 4xx', async () => {
    withToken()
    mockFetchError(401)

    const result = await publishToGbp({
      post_text: 'Big sale this weekend!',
      location_name: LOCATION_NAME,
    })

    expect(result.mode).toBe('draft')
    expect(result.degradation_reason).toMatch(/401/)
  })

  it('degrades to draft (does not throw) when fetch throws a network error', async () => {
    withToken()
    mockFetchThrow('Network request failed')

    const result = await publishToGbp({
      post_text: 'Opening hours update.',
      location_name: LOCATION_NAME,
    })

    expect(result.mode).toBe('draft')
    expect(result.degradation_reason).toMatch(/Network request failed/i)
  })
})

// ─── 2. 实时发布路径（API 成功）──────────────────────────────────────────────────

describe('publishToGbp — live publish', () => {
  it('calls GBP API with correct URL, headers, and body', async () => {
    withToken()
    mockFetchOk({ name: `${LOCATION_NAME}/localPosts/post_abc123` })

    await publishToGbp({
      post_text: 'Grand opening this Saturday!',
      location_name: LOCATION_NAME,
    })

    const [url, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ]
    expect(url).toContain(LOCATION_NAME.replace('accounts/', 'accounts/'))
    expect(url).toContain('localPosts')
    const headers = options.headers as Record<string, string>
    expect(headers['Authorization']).toBe(`Bearer ${TOKEN}`)
    expect(headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(options.body as string)
    expect(body.summary).toBe('Grand opening this Saturday!')
    expect(body.topicType).toBe('STANDARD')
  })

  it('returns live mode with post_name on success', async () => {
    withToken()
    const postName = `${LOCATION_NAME}/localPosts/post_xyz789`
    mockFetchOk({ name: postName })

    const result = await publishToGbp({
      post_text: 'We are now open!',
      location_name: LOCATION_NAME,
    })

    expect(result.mode).toBe('live')
    expect(result.post_name).toBe(postName)
    expect(result.draft_text).toBeUndefined()
  })

  it('includes callToAction in API body when cta_type and cta_url provided', async () => {
    withToken()
    mockFetchOk({ name: `${LOCATION_NAME}/localPosts/p1` })

    await publishToGbp({
      post_text: 'Book now for 20% off!',
      location_name: LOCATION_NAME,
      cta_type: 'BOOK',
      cta_url: 'https://example.com.au/book',
    })

    const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ]
    const body = JSON.parse(options.body as string)
    expect(body.callToAction).toEqual({
      actionType: 'BOOK',
      url: 'https://example.com.au/book',
    })
  })

  it('sends OFFER topicType when post_type is OFFER', async () => {
    withToken()
    mockFetchOk({ name: `${LOCATION_NAME}/localPosts/p2` })

    await publishToGbp({
      post_text: '30% off all week!',
      location_name: LOCATION_NAME,
      post_type: 'OFFER',
    })

    const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ]
    const body = JSON.parse(options.body as string)
    expect(body.topicType).toBe('OFFER')
  })
})

// ─── 3. 草稿内容格式 ──────────────────────────────────────────────────────────

describe('publishToGbp — draft content', () => {
  it('draft_text contains the original post_text', async () => {
    const result = await publishToGbp({
      post_text: 'We now offer same-day delivery across Brisbane!',
    })

    expect(result.draft_text).toContain('We now offer same-day delivery across Brisbane!')
  })

  it('draft_text mentions CTA details when provided', async () => {
    const result = await publishToGbp({
      post_text: 'Book your appointment today.',
      cta_type: 'BOOK',
      cta_url: 'https://example.com.au/book',
    })

    expect(result.draft_text).toContain('BOOK')
    expect(result.draft_text).toContain('https://example.com.au/book')
  })
})
