// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const fetchMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/net/safe-fetch', async original => ({ ...await original<typeof import('@/lib/net/safe-fetch')>(), safeFetchText: fetchMock }))
import { BlockedAddressError, ResponseTooLargeError } from '@/lib/net/safe-fetch'
import { scanWebsite, scanErrorMessage } from '../scan'
import { normalizeScanUrl, publicSource } from '../url'
import { createScanBudget } from '../budget'

function response(text = '<html><body><a href="tel:+6491234567">Call</a></body></html>', url = 'https://factory.example/', type = 'text/html') {
  return { text, url, headers: new Headers({ 'content-type': type }), status: 200, ok: true, hops: 0, statusText: 'OK' }
}
beforeEach(() => { fetchMock.mockReset() })

describe('URL validation', () => {
  it.each(['http://127.0.0.1', 'http://2130706433', 'http://[::1]', 'http://[::ffff:127.0.0.1]', 'http://169.254.169.254/latest/meta-data', 'http://10.0.0.1', 'http://192.168.1.1', 'http://localhost.', 'http://secret.internal', 'ftp://example.com', 'https://user:password@example.com', 'https://example.com:3000', 'https://example.com/?token=secret', 'https://example.com\\@evil.com'])('rejects unsafe input %s before reading', async value => {
    await expect(scanWebsite(value)).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('normalizes a normal domain and strips all query values from evidence', () => {
    expect(normalizeScanUrl('factory.example').href).toBe('https://factory.example/')
    expect(publicSource('https://factory.example/product?utm_source=private#value')).toBe('https://factory.example/product')
    expect(() => normalizeScanUrl('https://facebook.com.evil.example/page', true)).toThrow()
  })
})

describe('bounded static scan', () => {
  it('reads discovered layout code, not third-party tracker URLs, and tolerates failed ad reads', async () => {
    fetchMock.mockImplementation(async (url: URL | string) => {
      if (String(url).includes('facebook.com')) throw new Error('private internal error token=SECRET')
      if (String(url).endsWith('.js')) return response('fbq("init","12345678901234")', String(url), 'application/javascript')
      return response('<html><script src="/layout.js"></script><script src="https://connect.facebook.net/en_US/fbevents.js"></script><a href="tel:+6491234567">Call</a></html>')
    })
    const report = await scanWebsite('factory.example', 'https://www.facebook.com/business')
    expect(report.coverage).toEqual({ pages: 1, scripts: 1, incomplete: true })
    expect(report.checks.find(c => c.id === 'pixel')?.evidence).toContain('公开代码编号：12345678901234')
    expect(report.checks.find(c => c.id === 'ad')?.state).toBe('unknown')
    expect(JSON.stringify(report)).not.toContain('SECRET')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    for (const [, options] of fetchMock.mock.calls) {
      expect(options.maxResponseBytes).toBeLessThanOrEqual(750_000)
      expect(options.timeoutMs).toBeLessThanOrEqual(3000)
      expect(options.maxRedirects).toBeLessThanOrEqual(2)
      expect(options.headers).toBeUndefined()
    }
  })
  it('does not treat blocked redirects or timeout as successful reports', async () => {
    fetchMock.mockRejectedValue(new BlockedAddressError('internal.example', '127.0.0.1', 'loopback'))
    const failure = await scanWebsite('factory.example').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(BlockedAddressError)
    const mapped = scanErrorMessage(new Error('timeout with SECRET'))
    expect(mapped.status).toBe(422)
    expect(mapped.message).not.toContain('SECRET')
    expect(scanErrorMessage(new ResponseTooLargeError(10)).status).toBe(422)
  })
  it.each([response('{}', undefined, 'application/json'), { ...response(), ok: false, status: 403 }, response('<html><title>Just a moment...</title></html>')])('rejects non-HTML, challenge and HTTP failures', async result => {
    fetchMock.mockResolvedValue(result)
    await expect(scanWebsite('factory.example')).rejects.toThrow('没能读取完整网页')
  })
  it('reports changed UTM without returning parameter values', async () => {
    fetchMock.mockResolvedValue(response())
    const report = await scanWebsite('https://factory.example/?utm_source=PRIVATE_CAMPAIGN')
    expect(report.checks.find(c => c.id === 'utm')?.detail).toContain('不同')
    expect(JSON.stringify(report)).not.toContain('PRIVATE_CAMPAIGN')
  })
  it('releases concurrency once and retains the domain cooldown', () => {
    const budget = createScanBudget()
    const first = budget.acquire('a', 60_000)!
    const second = budget.acquire('b', 60_000)!
    expect(budget.acquire('c', 60_000)).toBeNull()
    first(); first()
    expect(budget.acquire('a', 60_001)).toBeNull()
    expect(budget.acquire('c', 60_001)).not.toBeNull()
    expect(budget.acquire('d', 60_001)).toBeNull()
    second()
    expect(budget.acquire('a', 90_001)).not.toBeNull()
  })
})
