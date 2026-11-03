import { describe, it, expect, vi, beforeEach } from 'vitest'

const dns = vi.hoisted(() => ({ resolve: vi.fn() }))
vi.mock('@/lib/net/safe-fetch', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/net/safe-fetch')>()
  return { ...actual, resolveValidatedAddress: dns.resolve }
})

import { validateViralSourceUrl, assertSafeViralSourceUrl } from '../viral-url-guard'

beforeEach(() => { dns.resolve.mockReset() })

const INJECTIONS = [
  'https://example.com/v"; touch /tmp/x #',
  'https://example.com/$(touch${IFS}/tmp/x)',
  'https://example.com/`touch /tmp/x`',
  'https://example.com/v\ntouch /tmp/x',
  'https://example.com/v\r\nx',
  'https://example.com/v|id',
  'https://example.com/v;id',
  'https://example.com/v\\x',
  "https://example.com/v'x",
  'https://example.com/a b',
  'https://example.com/v\u0000x',
]

const SSRF = [
  'http://127.0.0.1/x', 'http://localhost/x', 'http://foo.localhost/x', 'http://169.254.169.254/latest/meta-data/',
  'http://10.0.0.5/x', 'http://192.168.1.1/x', 'http://172.16.0.1/x', 'http://[::1]/x', 'http://[fd00::1]/x',
  'http://2130706433/x', 'http://0x7f000001/x', 'http://0/x', 'http://metadata/x', 'http://db.internal/x',
  'http://[::ffff:127.0.0.1]/x', 'http://100.64.0.1/x',
  'http://localhost./x', 'http://foo.localhost./x', 'http://metadata.google.internal./x', 'http://intranet./x', 'http://127.0.0.1./x',
]

describe('validateViralSourceUrl', () => {
  it.each(INJECTIONS)('rejects shell/control payload %j', u => {
    expect(validateViralSourceUrl(u).ok).toBe(false)
  })
  it.each(SSRF)('rejects internal target %s', u => {
    expect(validateViralSourceUrl(u).ok).toBe(false)
  })
  it.each(['file:///etc/passwd', 'ftp://example.com/x', 'javascript:alert(1)', 'gopher://example.com/', 'upload://clip.mp4'])(
    'rejects non-http scheme %s', u => expect(validateViralSourceUrl(u).ok).toBe(false))
  it('rejects credentials, odd ports, overlong, empty and non-strings', () => {
    expect(validateViralSourceUrl('https://u:p@example.com/x').ok).toBe(false)
    expect(validateViralSourceUrl('https://example.com:8080/x').ok).toBe(false)
    expect(validateViralSourceUrl(`https://example.com/${'a'.repeat(2100)}`).ok).toBe(false)
    expect(validateViralSourceUrl('').ok).toBe(false)
    expect(validateViralSourceUrl(null).ok).toBe(false)
    expect(validateViralSourceUrl({ toString: () => 'https://example.com' }).ok).toBe(false)
  })
  it.each([
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.facebook.com/reel/1234567890',
    'https://www.tiktok.com/@user/video/7300000000000000000',
    'https://www.instagram.com/reel/Cabc123/?igsh=abc%20d',
    'http://example.com:80/v.mp4',
    'https://www.xiaohongshu.com/explore/abc?xsec_token=AB%3D&xsec_source=pc_feed',
  ])('accepts legitimate url %s', u => {
    const r = validateViralSourceUrl(u)
    expect(r.ok).toBe(true)
  })
})

describe('assertSafeViralSourceUrl', () => {
  it('passes when every resolved address is public', async () => {
    dns.resolve.mockResolvedValue({ address: '93.184.216.34', family: 4, hostname: 'example.com' })
    await expect(assertSafeViralSourceUrl('https://example.com/v')).resolves.toBe('https://example.com/v')
  })
  it('rejects a public-looking hostname that resolves to a private address', async () => {
    dns.resolve.mockImplementation(async () => { throw new Error('blocked') })
    await expect(assertSafeViralSourceUrl('https://rebind.example.com/v')).rejects.toThrow(/public address/)
  })
  it('does not even resolve when the syntax check fails', async () => {
    await expect(assertSafeViralSourceUrl('https://example.com/$(id)')).rejects.toThrow(/forbidden/)
    expect(dns.resolve).not.toHaveBeenCalled()
  })
})
