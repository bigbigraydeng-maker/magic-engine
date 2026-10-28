import { describe, expect, it, vi } from 'vitest'
import { destinationKey, readDestination, requestTarget } from '../destination'
import { readLandingPage } from '../fetch-page'
import { landingHardCheck } from '../gate'
import { judgeDestination, needsPerson } from '../judge'
import { currentDestinationReceipt, receiptBody, readStoredReceipt } from '../receipt'

const SITE = 'https://example.test'
const PAGE = `${SITE}/offer`
const NOW = new Date('2026-10-28T12:00:00.000Z')

function pageDest(patch: Record<string, unknown> = {}) {
  return readDestination({
    status: 'awaiting_approval',
    accountLabel: '演示广告账户',
    draft: { kind: 'video_thruplay', linkUrl: PAGE, ...patch },
  })!
}

describe('landing destination', () => {
  it('treats a lead form as the destination and a link as a page', () => {
    const lead = readDestination({
      draft: { kind: 'lead_form', linkUrl: PAGE, leadFormId: 'form-1' },
    })
    expect(lead?.kind).toBe('lead_form')
    const page = pageDest()
    expect(page.kind).toBe('page')
    expect(readDestination({ draft: { kind: 'video_thruplay' } })?.kind).toBe('missing')
    expect(readDestination({ status: 'awaiting_approval' })).toBeNull()
  })

  it('refuses an address that is not on the client site and does not invent tags', () => {
    const dest = pageDest({ linkUrl: 'https://other.test/offer', urlTags: 'utm_source=ad' })
    expect(requestTarget(dest, SITE)).toEqual({ ok: false, reason: 'off_site' })
    expect(requestTarget(pageDest(), null)).toEqual({ ok: false, reason: 'no_site' })
    expect(requestTarget(pageDest({ urlTags: 'not tags' }), SITE)).toEqual({ ok: false, reason: 'bad_tags' })
    const tagged = requestTarget(pageDest({ urlTags: 'utm_source=ad' }), SITE)
    expect(tagged.ok).toBe(true)
    if (tagged.ok) expect(new URL(tagged.url).searchParams.get('utm_source')).toBe('ad')
  })

  it('changes the destination key when the address changes', () => {
    expect(destinationKey(pageDest())).not.toBe(destinationKey(pageDest({ linkUrl: `${SITE}/other` })))
  })
})

describe('landing judgement', () => {
  it('passes a page that loads, stays on the same path, keeps utm, and has the form fields', () => {
    const dest = pageDest({ urlTags: 'utm_source=ad&utm_medium=paid' })
    const target = requestTarget(dest, SITE)
    const items = judgeDestination(dest, target, {
      status: 200,
      finalUrl: `${PAGE}?utm_source=ad&utm_medium=paid`,
      html: '<form><input name="name"><input type="email" name="email"></form>',
      error: null,
    })
    expect(items.map((row) => row.state)).toEqual(['pass', 'pass', 'pass', 'pass'])
    expect(needsPerson(items)).toBe(false)
  })

  it('does not require a form or utm when the page has neither', () => {
    const dest = pageDest()
    const items = judgeDestination(dest, requestTarget(dest, SITE), {
      status: 200,
      finalUrl: `${PAGE}/`,
      html: '<main>Hello</main>',
      error: null,
    })
    expect(items.find((row) => row.key === 'form_fields')?.state).toBe('skip')
    expect(items.find((row) => row.key === 'utm')?.state).toBe('skip')
    expect(items.find((row) => row.key === 'right_page')?.state).toBe('pass')
    expect(needsPerson(items)).toBe(false)
  })

  it('fails a broken page, a wrong path, a thin form, and a dropped utm', () => {
    const dest = pageDest({ linkUrl: `${PAGE}?utm_source=ad` })
    const target = requestTarget(dest, SITE)
    const down = judgeDestination(dest, target, { status: 404, finalUrl: PAGE, html: null, error: null })
    expect(down.find((row) => row.key === 'loads')?.state).toBe('fail')
    const wrong = judgeDestination(dest, target, {
      status: 200,
      finalUrl: `${SITE}/elsewhere?utm_source=ad`,
      html: '<form><input name="email"></form>',
      error: null,
    })
    expect(wrong.find((row) => row.key === 'right_page')?.state).toBe('fail')
    expect(wrong.find((row) => row.key === 'form_fields')?.state).toBe('fail')
    const dropped = judgeDestination(dest, target, {
      status: 200,
      finalUrl: PAGE,
      html: '<main>Hello</main>',
      error: null,
    })
    expect(dropped.find((row) => row.key === 'utm')?.state).toBe('fail')
  })

  it('asks a person to look at a lead form and does not pretend the form loaded', () => {
    const dest = readDestination({ draft: { kind: 'lead_form', leadFormId: 'form-1', linkUrl: PAGE } })!
    const items = judgeDestination(dest, null, null)
    expect(items.find((row) => row.key === 'form_fields')).toMatchObject({ state: 'unchecked' })
    expect(needsPerson(items)).toBe(true)
    expect(JSON.stringify(items)).not.toContain('form-1')
  })

  it('does not open an off-site address', () => {
    const dest = pageDest({ linkUrl: 'https://other.test/offer' })
    const items = judgeDestination(dest, requestTarget(dest, SITE), null)
    expect(items.find((row) => row.key === 'loads')).toMatchObject({
      state: 'fail',
      detail: '地址不在这位客户的网站上，系统没有打开',
    })
    expect(JSON.stringify(items)).not.toContain('other.test')
  })
})

describe('landing gate', () => {
  const pass = receiptBody(NOW.toISOString(), 'key', [
    { key: 'loads', state: 'pass', detail: '页面能打开' },
    { key: 'right_page', state: 'pass', detail: '打开的就是这一页' },
    { key: 'form_fields', state: 'skip', detail: '这一页没有表单' },
    { key: 'utm', state: 'skip', detail: '这条广告没有带追踪参数' },
  ])

  it('blocks go-live when the check failed and nobody confirmed it', () => {
    const failed = receiptBody(NOW.toISOString(), 'key', [
      { ...pass.items[0], state: 'fail', detail: '页面没有打开' },
      pass.items[1],
      pass.items[2],
      pass.items[3],
    ])
    expect(landingHardCheck({ receipt: null, confirmed: false, now: NOW }).state).toBe('unread')
    expect(landingHardCheck({ receipt: failed, confirmed: false, now: NOW })).toMatchObject({ state: 'red' })
    expect(landingHardCheck({ receipt: failed, confirmed: true, now: NOW }).state).toBe('green')
    expect(landingHardCheck({ receipt: pass, confirmed: false, now: NOW })).toMatchObject({
      state: 'green',
      reason: '能打开，而且是这一页',
    })
  })

  it('ignores a confirmation once the result is stale', () => {
    const old = receiptBody('2026-10-26T00:00:00.000Z', 'key', pass.items)
    expect(landingHardCheck({ receipt: old, confirmed: true, now: NOW }).state).toBe('unread')
  })

  it('rejects a receipt that is not the four checks', () => {
    expect(readStoredReceipt({ landing_verify: { v: 1, checkedAt: NOW.toISOString(), destinationKey: 'k', items: [] } })).toBeNull()
    expect(readStoredReceipt({})).toBeNull()
  })

  it('does not reuse a green result after the draft changes its destination', () => {
    const old = { status: 'awaiting_approval', draft: { kind: 'video_thruplay', linkUrl: PAGE } }
    const changed = { ...old, draft: { kind: 'video_thruplay', linkUrl: `${SITE}/other` }, landing_verify: receiptBody(NOW.toISOString(), destinationKey(readDestination(old)!), pass.items) }
    expect(currentDestinationReceipt(changed)).toBeNull()
    expect(landingHardCheck({ receipt: currentDestinationReceipt(changed), confirmed: false, now: NOW }).state).toBe('unread')
  })
})

describe('landing page read', () => {
  it('uses a GET, stops at another site, and times out', async () => {
    const calls: string[] = []
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? ''} ${url}`)
      expect(init?.method).toBe('GET')
      expect(init?.redirect).toBe('manual')
      return new Response(null, { status: 302, headers: { location: 'https://other.test/away' } })
    })
    const stopped = await readLandingPage(PAGE, { siteUrl: SITE, fetcher, sleep: async () => undefined })
    expect(stopped.error).toContain('别的网站')
    expect(calls).toEqual([`GET ${PAGE}`])

    const hung = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    }))
    const timed = await readLandingPage(PAGE, { siteUrl: SITE, fetcher: hung, timeoutMs: 20, sleep: async () => undefined })
    expect(timed.error).toContain('时限')
    expect(await readLandingPage('https://other.test/x', { siteUrl: SITE, fetcher, sleep: async () => undefined })).toMatchObject({
      error: '地址不在这位客户的网站上',
    })
    expect(calls).toEqual([`GET ${PAGE}`])
  })

  it('times out while waiting for a stalled response body', async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({ cancel: () => { cancelled = true } })
    const fetcher = vi.fn(async () => new Response(stream, { status: 200 }))
    const result = await Promise.race([
      readLandingPage(PAGE, { siteUrl: SITE, fetcher, timeoutMs: 20 }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('body read never returned')), 200)),
    ])
    expect(result.error).toContain('时限')
    expect(cancelled).toBe(true)
  })
})
