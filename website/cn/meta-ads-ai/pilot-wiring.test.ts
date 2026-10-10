import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost } from '../../functions/api/waitlist.js'
import { onRequestPost as onLeadEventPost } from '../../functions/api/lead-event.js'

const pilotScript = readFileSync(resolve(__dirname, 'pilot.js'), 'utf8')
const pilotPage = readFileSync(resolve(__dirname, 'index.html'), 'utf8')
const labPage = readFileSync(resolve(__dirname, '../lab/index.html'), 'utf8')

function applicationRequest() {
  return new Request('https://magicengine.com.au/api/waitlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      formType: 'meta_ads_ai_pilot',
      name: '王小明',
      email: 'applicant@example.com',
      company: '示例外贸公司',
      website: '',
      country: '国内（往海外卖）',
      industry: '工具实验室：Facebook 广告体检',
      targetMarket: '未询问（轻量表单）',
      platforms: ['Meta (Facebook / Instagram)'],
      budget: '未询问（轻量表单）',
      goal: '想用的工具：Facebook 广告体检\n需求：希望看懂广告表现',
      companyWebsite: '',
      consent: true,
    }),
  })
}

describe('Meta Ads AI pilot application wiring', () => {
  afterEach(() => vi.restoreAllMocks())

  it('keeps the ads page connected to the light form and the app', () => {
    expect(pilotPage).toContain('data-pilot-form')
    expect(pilotPage).toContain('/cn/meta-ads-ai/pilot.js')
    expect(pilotPage).toContain('https://app.magicengine.com.au/meta-ads-ai/mine')
    expect(pilotPage).not.toContain('noindex')
    expect(pilotPage).not.toContain('Magic Bridge')
    expect(pilotPage).not.toContain('内测')
    expect(pilotPage).not.toContain('候补')
  })

  it('keeps the lab page linked to the ads page and the notify form', () => {
    expect(labPage).toContain('/cn/meta-ads-ai/')
    expect(labPage).toContain('data-pilot-form')
    expect(labPage).toContain('id="notify"')
  })

  it('keeps the light form handler wired to the waitlist API', () => {
    expect(pilotScript).toContain("formType: 'meta_ads_ai_pilot'")
    expect(pilotScript).toContain("fetch('/api/waitlist'")
    expect(pilotScript).toContain("targetMarket: '未询问（轻量表单）'")
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

  it('rejects a lead event without a valid ctaKey', async () => {
    const response = await onLeadEventPost({
      request: new Request('https://magicengine.com.au/api/lead-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ctaKey: 'tool_signup' }),
      }),
    })

    expect(response.status).toBe(400)
  })
})
