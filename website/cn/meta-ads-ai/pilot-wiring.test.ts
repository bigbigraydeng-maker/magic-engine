import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost } from '../../functions/api/waitlist.js'

const pilotScript = readFileSync(resolve(__dirname, 'pilot.js'), 'utf8')
const pilotPage = readFileSync(resolve(__dirname, 'index.html'), 'utf8')

function applicationRequest() {
  return new Request('https://magicengine.com.au/api/waitlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      formType: 'meta_ads_ai_pilot',
      name: '王小明',
      email: 'applicant@example.com',
      company: '示例外贸公司',
      website: 'https://example.com',
      country: '中国',
      industry: '工业设备',
      targetMarket: '澳大利亚',
      platforms: ['Meta (Facebook / Instagram)'],
      budget: '已经投放',
      goal: '希望看懂广告表现',
      companyWebsite: '',
      consent: true,
    }),
  })
}

describe('Meta Ads AI pilot application wiring', () => {
  afterEach(() => vi.restoreAllMocks())

  it('keeps the public page connected to a payload marked as a pilot application', () => {
    expect(pilotPage).toContain('data-pilot-form')
    expect(pilotPage).toContain('/cn/meta-ads-ai/pilot.js')
    expect(pilotScript).toContain("formType: 'meta_ads_ai_pilot'")
    expect(pilotScript).toContain("fetch('/api/waitlist'")
  })

  it('forwards the whitelisted form type to the existing app contact API', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )

    const response = await onRequestPost({
      request: applicationRequest(),
      env: { CONTACT_API_URL: 'https://staging.example/api/contact' },
    })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(String(init?.body))).toMatchObject({
      formType: 'meta_ads_ai_pilot',
      email: 'applicant@example.com',
    })
  })

  it('does not forward arbitrary form-type values', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
    const body = await applicationRequest().json()
    body.formType = 'send_some_other_email'

    await onRequestPost({
      request: new Request('https://magicengine.com.au/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      env: { CONTACT_API_URL: 'https://staging.example/api/contact' },
    })

    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('formType')
  })
})
