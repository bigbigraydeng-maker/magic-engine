// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const scanMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/ad-path-checker/scan', async original => ({ ...await original<typeof import('@/lib/ad-path-checker/scan')>(), scanWebsite: scanMock }))
import { POST } from '../route'
import { exampleReport } from '@/lib/ad-path-checker/example'

let number = 0
function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3217/api/tools/ad-path-check', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
}
beforeEach(() => { vi.stubEnv('AD_PATH_CHECKER_ENABLED', 'true'); scanMock.mockReset(); number++ })
afterEach(() => vi.unstubAllEnvs())

describe('public scan endpoint', () => {
  it('is dark by default without consuming network calls', async () => {
    vi.stubEnv('AD_PATH_CHECKER_ENABLED', '')
    expect((await POST(request({ url: 'factory.example' }))).status).toBe(503)
    expect(scanMock).not.toHaveBeenCalled()
  })
  it('refuses cross-origin submissions, oversized bodies and private URLs', async () => {
    expect((await POST(request({ url: 'factory.example' }, { origin: 'https://other.example' }))).status).toBe(403)
    expect((await POST(request({ url: 'a'.repeat(9000) }))).status).toBe(400)
    expect((await POST(request({ url: 'http://169.254.169.254' }))).status).toBe(400)
    expect(scanMock).not.toHaveBeenCalled()
  })
  it('returns a real result with no-store and does not cache input', async () => {
    scanMock.mockResolvedValue({ ...exampleReport, mode: 'live' })
    const response = await POST(request({ url: `factory${number}.example` }))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect((await response.json()).report.mode).toBe('live')
  })
  it('accepts the browser origin when Next canonicalizes the loopback hostname', async () => {
    scanMock.mockResolvedValue({ ...exampleReport, mode: 'live' })
    const response = await POST(request({ url: `loopback${number}.example` }, { origin: 'http://127.0.0.1:3217', host: '127.0.0.1:3217', 'sec-fetch-site': 'same-origin' }))
    expect(response.status).toBe(200)
  })
  it('returns safe failure text and releases the slot after an exception', async () => {
    scanMock.mockRejectedValueOnce(new Error('database password SECRET')).mockResolvedValueOnce({ ...exampleReport, mode: 'live' })
    const failure = await POST(request({ url: `broken${number}.example` }))
    expect(failure.status).toBe(422)
    expect(await failure.text()).not.toContain('SECRET')
    expect((await POST(request({ url: `recovery${number}.example` }))).status).toBe(200)
  })
})
