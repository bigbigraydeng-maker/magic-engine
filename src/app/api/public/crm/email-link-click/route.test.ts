import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { marker: 'db' } }))
vi.mock('@/lib/microsoft/mail-send-new-prod', () => ({ createMailNewStore: vi.fn(() => ({ marker: 'mail' })) }))
vi.mock('@/lib/crm/email-templates/link-tracking/click-store-prod', () => ({ createClickStore: vi.fn(() => ({ marker: 'store' })) }))
vi.mock('@/lib/crm/email-templates/link-tracking/record-click', async () => {
  const actual = await vi.importActual<typeof import('@/lib/crm/email-templates/link-tracking/record-click')>(
    '@/lib/crm/email-templates/link-tracking/record-click',
  )
  return { ...actual, recordClick: vi.fn(async () => 'recorded') }
})

import { recordClick } from '@/lib/crm/email-templates/link-tracking/record-click'
import { POST } from './route'

const post = (raw: string) => POST(new NextRequest('http://x/api/public/crm/email-link-click', { method: 'POST', body: raw }))
const good = JSON.stringify({ token: 'AAAAAAAAAAAA', path: '/b.pdf', method: 'GET', ua: 'Mozilla/5.0' })

beforeEach(() => vi.clearAllMocks())

describe('POST /api/public/crm/email-link-click', () => {
  it('a well-formed report is recorded and answered 204 with no body', async () => {
    const res = await post(good)
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
    expect(recordClick).toHaveBeenCalledTimes(1)
  })

  it('a malformed token is refused before anything is read', async () => {
    const res = await post(JSON.stringify({ token: "x' or 1=1", method: 'GET' }))
    expect(res.status).toBe(400)
    expect(recordClick).not.toHaveBeenCalled()
  })

  it('a body over 1KB is refused', async () => {
    const res = await post(JSON.stringify({ token: 'AAAAAAAAAAAA', method: 'GET', ua: 'x'.repeat(2000) }))
    expect(res.status).toBe(413)
    expect(recordClick).not.toHaveBeenCalled()
  })

  it('not JSON → 400', async () => {
    expect((await post('{nope')).status).toBe(400)
  })

  it('a failure while recording still answers 204 (the website never waits on us, and learns nothing)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    ;(recordClick as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('db down'))
    expect((await post(good)).status).toBe(204)
  })
})
