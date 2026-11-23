import { beforeEach, describe, expect, it, vi } from 'vitest'

const dns = vi.hoisted(() => ({ resolve: vi.fn() }))
vi.mock('@/lib/net/safe-fetch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/net/safe-fetch')>()
  return { ...actual, resolveValidatedAddress: dns.resolve }
})

import { assertSafeNewsFeedUrl, validateNewsFeedUrl } from './intake-news-feed-url'
import { normalizeNewsFeedUrls } from './intake-config'

beforeEach(() => {
  dns.resolve.mockReset()
})

describe('validateNewsFeedUrl', () => {
  it.each([
    'http://127.0.0.1/feed',
    'http://localhost/rss',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1/feed',
    'http://192.168.0.1/feed',
    'http://172.16.0.1/feed',
    'http://[::1]/feed',
    'http://[fd00::1]/feed',
    'http://[::ffff:127.0.0.1]/feed',
  ])('rejects internal target %s', (url) => {
    expect(validateNewsFeedUrl(url).ok).toBe(false)
  })

  it('accepts a normal https feed url', () => {
    expect(validateNewsFeedUrl('https://example.com/feed.xml').ok).toBe(true)
  })
})

describe('normalizeNewsFeedUrls', () => {
  it('drops blocked urls and keeps public feeds', () => {
    expect(
      normalizeNewsFeedUrls([
        'https://example.com/feed.xml',
        'http://127.0.0.1/secret',
        'https://example.com/feed.xml',
      ]),
    ).toEqual(['https://example.com/feed.xml'])
  })
})

describe('assertSafeNewsFeedUrl', () => {
  it('passes when DNS resolves to a public address', async () => {
    dns.resolve.mockResolvedValue({ address: '93.184.216.34', family: 4, hostname: 'example.com' })
    await expect(assertSafeNewsFeedUrl('https://example.com/feed.xml')).resolves.toBe(
      'https://example.com/feed.xml',
    )
  })

  it('rejects when DNS validation fails', async () => {
    dns.resolve.mockImplementation(async () => {
      throw new Error('blocked')
    })
    await expect(assertSafeNewsFeedUrl('https://rebind.example.com/feed.xml')).rejects.toThrow(
      /public address/,
    )
  })
})
