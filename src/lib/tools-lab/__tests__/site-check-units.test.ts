// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── module mocks (hoisted) ──────────────────────────────────────────────────
const rpcMock = vi.fn()
const fromMock = vi.fn()
const callClaudeChatMock = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args),
  },
}))

vi.mock('@/lib/anthropic/client', () => ({
  callClaudeChat: (...args: unknown[]) => callClaudeChatMock(...args),
  MODEL_HAIKU: 'claude-haiku-4-5-20251001',
}))

vi.mock('@/lib/net/safe-fetch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/net/safe-fetch')>()
  return { ...actual, safeFetchText: vi.fn() }
})

import { BlockedAddressError, safeFetchText, type SafeFetchTextOptions, type SafeFetchTextResponse } from '@/lib/net/safe-fetch'
import { consumeQuota, defangLinks, QuotaUnavailable, vetUrl } from '@/lib/tools-lab/site-check/guards'
import {
  isCloudflareAddress,
  normaliseRecipient,
  recipientKey,
  visitorAddress,
  visitorKey,
} from '@/lib/tools-lab/visitor'
import {
  extractText,
  extractTitle,
  fetchRealHomepage,
  homepageOf,
  looksLikeChallenge,
} from '@/lib/tools-lab/site-check/homepage'

const safeFetchTextMock = vi.mocked(safeFetchText)

const ENV = { SUPABASE_SERVICE_ROLE_KEY: 'service-key', RESEND_API_KEY: 'r' }
const LONG = 'Industrial valves for export. '.repeat(30)
const PAGE = `<html><head><title>Acme Valves</title></head><body><h1>Acme</h1><p>${LONG}</p><a href="mailto:sales@acme.com">Contact</a></body></html>`

const TRUSTED = { 'x-forwarded-for': '203.0.113.7, 162.158.10.1', 'cf-connecting-ip': '203.0.113.7' }

function hdrs(cfIp: string, xff = `${cfIp}, 162.158.10.1`): Headers {
  return new Headers({ 'x-forwarded-for': xff, 'cf-connecting-ip': cfIp })
}

function page(text: string, opts: { status?: number; url?: string; type?: string } = {}) {
  const status = opts.status ?? 200
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    url: opts.url ?? 'https://acme.com/',
    headers: new Headers({ 'content-type': opts.type ?? 'text/html; charset=utf-8' }),
    hops: 0,
    text,
  }
}

beforeEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = ENV.SUPABASE_SERVICE_ROLE_KEY
  process.env.RESEND_API_KEY = ENV.RESEND_API_KEY
  safeFetchTextMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

// ── guards ──────────────────────────────────────────────────────────────────
describe('vetUrl', () => {
  it.each([
    'http://127.0.0.1/',
    'https://localhost',
    'https://10.0.0.1',
    'https://[::1]/',
    'https://acme.com:8080',
    'ftp://acme.com',
    'https://user:pw@acme.com',
    'https://printer.local',
    'https://acme.com.',
    'https://box.localhost',
    `https://acme.com/${'a'.repeat(600)}`,
  ])('rejects %s', (u) => {
    expect(vetUrl(u)).toBeNull()
  })
  it('accepts a normal address with or without scheme', () => {
    expect(vetUrl('acme.com')?.toString()).toBe('https://acme.com/')
    expect(vetUrl('http://www.acme.co.nz/about')?.hostname).toBe('www.acme.co.nz')
  })
})

describe('fetchRealHomepage — only a real page of the same site counts', () => {
  const run = (impl: (url: string) => ReturnType<typeof page>) =>
    fetchRealHomepage('acme.com', { fetchText: async (url: string | URL) => impl(String(url)) })

  it('404 → unreachable', async () => {
    const r = await run(() => page('Not found', { status: 404 }))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toBe('unreachable')
  })
  it('not HTML → not_html', async () => {
    const r = await run(() => page('%PDF', { type: 'application/pdf' }))
    expect(r.ok === false && r.reason).toBe('not_html')
  })
  it('Cloudflare challenge → challenge', async () => {
    const r = await run(() => page(`<title>Just a moment...</title>${LONG}`))
    expect(r.ok === false && r.reason).toBe('challenge')
  })
  it('almost no text (JS-only shell) → too_little_text', async () => {
    const r = await run(() => page('<div id="root"></div><script>app()</script>'))
    expect(r.ok === false && r.reason).toBe('too_little_text')
  })
  it('final url on another site → redirected_away', async () => {
    const r = await run(() => page(PAGE, { url: 'https://parked-domains.example/' }))
    expect(r.ok === false && r.reason).toBe('redirected_away')
  })
  it('declared GBK / meta gb2312 pages → encoding (never diagnose mojibake)', async () => {
    const a = await run(() => page(PAGE, { type: 'text/html; charset=GBK' }))
    expect(a.ok === false && a.reason).toBe('encoding')
    const b = await run(() => page(`<meta charset="gb2312">${PAGE}`))
    expect(b.ok === false && b.reason).toBe('encoding')
  })
  it('only ever fetches the homepage, whatever path or query the visitor gives', async () => {
    const fetchText = vi.fn(async (_u: string | URL, _o?: SafeFetchTextOptions) => page(PAGE))
    await fetchRealHomepage('https://acme.com/some/path?q=1', { fetchText })
    expect(fetchText.mock.calls.map(([u]) => String(u))).toEqual(['https://acme.com/'])
    expect(fetchText.mock.calls[0]?.[1]?.maxRedirects).toBe(3)
    expect(homepageOf('acme.com/blog/post?x=1')).toBe('https://acme.com/')
  })
  it('a same-site final url (www) is fine and the page is read', async () => {
    const r = await run(() => page(PAGE, { url: 'https://www.acme.com/' }))
    expect(r.ok).toBe(true)
    expect(r.ok && r.text).toContain('Industrial valves')
  })
  it('BlockedAddressError → blocked_address', async () => {
    const r = await fetchRealHomepage('acme.com', {
      fetchText: async (): Promise<SafeFetchTextResponse> => {
        throw new BlockedAddressError('acme.com', '10.0.0.1', 'private')
      },
    })
    expect(r.ok === false && r.reason).toBe('blocked_address')
  })
  it('any other fetch error → unreachable', async () => {
    const r = await fetchRealHomepage('acme.com', {
      fetchText: async (): Promise<SafeFetchTextResponse> => {
        throw new Error('dns down')
      },
    })
    expect(r.ok === false && r.reason).toBe('unreachable')
  })
  it('fetch that never resolves → unreachable within the budget', async () => {
    const r = await fetchRealHomepage('acme.com', {
      fetchText: () => new Promise<SafeFetchTextResponse>(() => undefined),
      budgetMs: 20,
    })
    expect(r.ok === false && r.reason).toBe('unreachable')
  })
  it('SiteGround captcha page with plenty of text → challenge (our own check, not only the shared detector)', async () => {
    const r = await run(() => page(`<title>Welcome</title><div class="sgcaptcha">${LONG}</div>`))
    expect(r.ok === false && r.reason).toBe('challenge')
  })
  it('looksLikeChallenge spots firewall pages directly', () => {
    expect(looksLikeChallenge('Just a moment...', LONG, '')).toBe(true)
    expect(looksLikeChallenge('Acme', LONG, '<div class="sgcaptcha">')).toBe(true)
    expect(looksLikeChallenge('Acme', LONG, '<p>hello</p>')).toBe(false)
  })
})

describe('extractText / extractTitle', () => {
  it('drops script/style/noscript, keeps text, decodes &amp;', () => {
    expect(
      extractText('<p>Hi <b>there</b></p><script>x()</script><style>.a{}</style> ok &amp; <noscript>n</noscript>'),
    ).toBe('Hi there ok &')
  })
  it('reads a title case-insensitively and collapses whitespace', () => {
    expect(extractTitle('<TITLE lang="en"> Acme  Ltd </title>')).toBe('Acme Ltd')
  })
  it('attacker HTML with 1MB of unclosed tags is processed in linear time', () => {
    for (const chunk of ['<script', '<', '<title', '<style x']) {
      const html = chunk.repeat(Math.ceil(1_000_000 / chunk.length))
      const t0 = Date.now()
      extractText(html)
      extractTitle(html)
      expect(Date.now() - t0).toBeLessThan(500)
    }
  })
})

describe('visitorKey', () => {
  it('no Cloudflare client address → null (request refused)', () => {
    expect(visitorKey(new Headers({}), 'site-check')).toBeNull()
  })
  it('stable within a day, different next day, never the raw address', () => {
    const h = new Headers(TRUSTED)
    const a = visitorKey(h, 'site-check', new Date('2026-09-27T10:00:00Z'))
    const b = visitorKey(h, 'site-check', new Date('2026-09-27T23:00:00Z'))
    const c = visitorKey(h, 'site-check', new Date('2026-09-28T01:00:00Z'))
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).not.toContain('203.0.113.7')
  })
  it('IPv4-mapped IPv6 is keyed as the IPv4 address (not one shared bucket)', () => {
    const k = (ip: string) => visitorKey(hdrs(ip), 'site-check', new Date('2026-09-27T10:00:00Z'))
    expect(k('::ffff:198.51.100.4')).toBe(k('198.51.100.4'))
    expect(k('::ffff:198.51.100.4')).not.toBe(k('::ffff:198.51.100.5'))
  })
  it('IPv6 addresses in the same /48 share one key', () => {
    const k = (ip: string) => visitorKey(hdrs(ip), 'site-check', new Date('2026-09-27T10:00:00Z'))
    expect(k('2001:db8:1:2::1')).toBe(k('2001:db8:1:ffff::9'))
    expect(k('2001:db8:1:2::1')).not.toBe(k('2001:db8:2::1'))
  })
  it('no server key configured → null (request refused, never a shared bucket)', () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    expect(visitorKey(new Headers(TRUSTED), 'site-check')).toBeNull()
  })
  it('forged cf-connecting-ip without a Cloudflare hop → null', () => {
    expect(visitorKey(hdrs('203.0.113.7', '8.8.8.8'), 'site-check')).toBeNull()
    expect(visitorKey(hdrs('203.0.113.7', '203.0.113.7, 8.8.8.8, 10.0.0.5'), 'site-check')).toBeNull()
  })
  it('only x-forwarded-for, no cf-connecting-ip → null', () => {
    expect(visitorKey(new Headers({ 'x-forwarded-for': '203.0.113.7, 162.158.10.1' }), 'site-check')).toBeNull()
  })
  it('attacker-supplied leftmost xff entry does not matter', () => {
    const a = visitorKey(new Headers(TRUSTED), 'site-check', new Date('2026-09-27T10:00:00Z'))
    const b = visitorKey(hdrs('203.0.113.7', '1.2.3.4, 203.0.113.7, 162.158.10.1'), 'site-check', new Date('2026-09-27T10:00:00Z'))
    expect(a).toBe(b)
  })
  it('internal hop after Cloudflare is skipped', () => {
    expect(visitorAddress(hdrs('203.0.113.7', '203.0.113.7, 162.158.10.1, 10.0.0.5'))).not.toBeNull()
  })
  it('isCloudflareAddress recognises Cloudflare ranges only', () => {
    expect(isCloudflareAddress('162.158.10.1')).toBe(true)
    expect(isCloudflareAddress('8.8.8.8')).toBe(false)
    expect(isCloudflareAddress('2606:4700::1')).toBe(true)
  })
  it('a different tool namespace never shares a bucket with site-check, even same address/day', () => {
    const h = new Headers(TRUSTED)
    const now = new Date('2026-09-27T10:00:00Z')
    expect(visitorKey(h, 'site-check', now)).not.toBe(visitorKey(h, 'ads-check', now))
  })
  it('regression pin: site-check keeps producing the exact key it always has (tool param defaults nothing away)', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
    const key = visitorKey(new Headers(TRUSTED), 'site-check', new Date('2026-09-27T10:00:00Z'))
    // Pinned from this exact input before the tool param existed — must never change for existing traffic.
    expect(key).toBe('e6887de0ad52e3b69cd62cab9b5741952b456a2cb64ce3f3ddd7d2c60de14992')
  })
})

describe('normaliseRecipient / recipientKey', () => {
  it('lower-cases, drops +tag, and ignores dots for Gmail', () => {
    expect(normaliseRecipient('A.B+news@GoogleMail.com')).toBe('ab@gmail.com')
    expect(normaliseRecipient('a.b+x@acme.com')).toBe('a.b@acme.com')
  })
  it('recipientKey returns null without a server key', () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    expect(recipientKey('a@b.com', 'site-check')).toBeNull()
  })
  it('recipientKey is namespaced by tool too, same email same day', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
    expect(recipientKey('a@b.com', 'site-check')).not.toBe(recipientKey('a@b.com', 'ads-check'))
  })
})

describe('consumeQuota fails closed', () => {
  it('store error → QuotaUnavailable', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'down' } })
    await expect(consumeQuota('site_check_ip', 'k', '2026-09-27T00:00:00Z', 3)).rejects.toBeInstanceOf(QuotaUnavailable)
  })
  it('network failure → QuotaUnavailable', async () => {
    rpcMock.mockRejectedValueOnce(new Error('offline'))
    await expect(consumeQuota('site_check_ip', 'k', '2026-09-27T00:00:00Z', 3)).rejects.toBeInstanceOf(QuotaUnavailable)
  })
})


describe('defangLinks', () => {
  it('breaks addresses and bare domains so mail clients cannot auto-link them', () => {
    expect(defangLinks('see https://evil.com/a and www.x.io and shop.example.co.nz')).toBe(
      'see hxxps://evil[.]com/a and www[.]x[.]io and shop[.]example[.]co[.]nz',
    )
    expect(defangLinks('没有链接的中文')).toBe('没有链接的中文')
  })
  it('breaks shorteners, messengers and payment links, including non-Latin domains', () => {
    const out = defangLinks('go to bit.ly/abc or t.me/scam, wa.me/61400000000, paypal.me/x, evil.ru/login, 支付宝.com')
    for (const bad of ['bit.ly', 't.me', 'wa.me', 'paypal.me', 'evil.ru', '支付宝.com']) {
      expect(out).not.toContain(bad)
    }
    expect(out).toContain('bit[.]ly')
    expect(out).toContain('支付宝[.]com')
  })
  it('leaves a decimal number alone', () => {
    expect(defangLinks('price 3.5 kg')).toContain('3.5')
  })
})


describe('defangLinks — schemes', () => {
  it('breaks http(s) links to bare IPs and localhost', () => {
    const out = defangLinks('log in at http://45.12.3.4/login or https://localhost:8080/x')
    expect(out).not.toMatch(/https?:\/\//i)
    expect(out).toContain('hxxp://45')
    expect(out).toContain('hxxps://localhost')
  })
})
