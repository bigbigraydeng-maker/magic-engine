/**
 * 链接检查（欢迎信事故的同一类问题：下架团页仍返回 200，只看 HTTP 状态验不出来）。
 *
 * 钉死的事：
 *  · 白名单里的每种主机写法（带 / 不带 www）都按同一套团页规则检查；不认识的 /tours/ 深层页面也拦
 *  · 链接后面紧跟中文 / 句号不能让链接「变形」躲过检查；链接里编码过的主机、用空格连字符串起来的第二个链接、大小写、裸域名都认得出
 *  · 不用团目录的模板、自由写的信，同样检查；预览与真发送给出同一个结论
 *  · 隐形字符夹在禁用词中间、`[Name]` 之类的留稿标记，都拦得住
 */

import { describe, expect, it, vi } from 'vitest'
import { evaluateContentGates } from '@/lib/crm/email-templates/gates/content-gates'
import { createSendGates, type PreLockArgs } from '@/lib/crm/email-templates/send-gates'
import { previewTemplate } from '@/lib/crm/email-templates/template-preview'
import { getProvider } from '@/lib/crm/email-templates/facts/registry'
import type { RenderFacts } from '@/lib/crm/email-templates/facts/types'
import { config, makeData, settingsObj, template, tour } from './fixtures'

const NOW = new Date('2026-10-28T02:00:00.000Z')
const provider = getProvider('published_tours')
const gone = tour({ id: 't2', slug: 'gone', soldOut: true })
const live = tour()
const settings = settingsObj()

const facts: RenderFacts = {
  tours: [live, gone],
  picks: [],
  settings: settings.providers.publishedTours ?? null,
  linkHosts: settings.guardrails.allowedLinkHosts,
}

const check = (body: string, over: Partial<RenderFacts> = {}) =>
  evaluateContentGates({ subject: 'Hello', body, footer: null, settings, provider, facts: { ...facts, ...over } })
const codes = (body: string, over: Partial<RenderFacts> = {}): string[] => check(body, over).blocks.map((b) => b.code)

describe('tour page links', () => {
  it('a taken-down tour page is blocked on the main host', () => {
    expect(codes('See https://www.example.com/tours/china/discovery/gone')).toContain('tour_page_not_on_sale')
  })

  it('and on the other allowed spelling of the host (no www) — it used to slip through', () => {
    expect(codes('See https://example.com/tours/china/discovery/gone')).toContain('tour_page_not_on_sale')
    expect(codes('See https://EXAMPLE.com./tours/china/discovery/gone')).toContain('tour_page_not_on_sale')
  })

  it('a departure date that is not on sale is blocked on either host', () => {
    expect(codes('See https://example.com/tours/china/discovery/essentials?date=2030-01-01')).toContain('departure_not_on_sale')
    expect(codes('See https://www.example.com/tours/china/discovery/essentials?date=2030-01-01')).toContain('departure_not_on_sale')
  })

  it('a link followed by Chinese text or a Chinese full stop is still read as the link', () => {
    expect(codes('详见 https://www.example.com/tours/china/discovery/gone。谢谢')).toContain('tour_page_not_on_sale')
    expect(codes('详见https://example.com/tours/china/discovery/gone，请看')).toContain('tour_page_not_on_sale')
  })

  it('a GOOD tour link followed by Chinese text or a full stop is still accepted (the text after it is not part of the link)', () => {
    expect(codes('详见 https://www.example.com/tours/china/discovery/essentials?date=2027-03-11。谢谢')).toEqual([])
    expect(codes('详见www.example.com/tours/china/discovery/essentials，谢谢')).toEqual([])
    expect(codes('详见 https://example.com/tours/china/discovery/essentials。')).toEqual([])
  })

  it('the list page is allowed even when the "all tours" setting points somewhere else; other pages under the section are not', () => {
    const elsewhere = { settings: { urlPattern: 'https://www.example.com/tours/{destination}/{tier}/{slug}', allToursUrl: 'https://www.example.com/tours/everything' } }
    expect(codes('List: https://www.example.com/tours', elsewhere)).toEqual([])
    expect(codes('All: https://www.example.com/tours/everything', elsewhere)).toEqual([])
    expect(codes('Other: https://www.example.com/tours/other', elsewhere)).toContain('tour_page_not_on_sale')
  })

  it('an unrecognised deep page under the tours section is not vouched for', () => {
    expect(codes('See https://www.example.com/tours/china/old-tour')).toContain('tour_page_not_on_sale')
  })

  it('pages that are fine stay fine: a live tour with a valid date, the list of all tours, other pages of the site', () => {
    expect(codes('See https://www.example.com/tours/china/discovery/essentials?date=2027-03-11')).toEqual([])
    expect(codes('All tours: https://www.example.com/tours and https://example.com/tours/')).toEqual([])
    expect(codes('About us: https://www.example.com/about')).toEqual([])
  })

  it('a caller that forgets to pass the allowed-host list cannot re-open the hole: the gate supplies it from the settings', () => {
    expect(codes('See https://www.example.com/tours/china/discovery/gone', { linkHosts: undefined })).toContain('tour_page_not_on_sale')
    expect(codes('See https://example.com/tours/china/discovery/gone', { linkHosts: undefined })).toContain('tour_page_not_on_sale')
    expect(codes('See example.com/tours/china/discovery/gone', { linkHosts: undefined })).toContain('tour_page_not_on_sale')
  })
})

describe('tricks with the link itself', () => {
  it('an encoded host is not read as a trusted one: good.example%2F@evil.com is a link to evil.com', () => {
    const found = codes('Book at https://www.example.com%2F@evil.com/pay')
    expect(found).toContain('link_userinfo')
    expect(found).toContain('link_host_not_allowed')
  })

  it('a second link joined by " - " is a link of its own, not part of the first one', () => {
    const blocks = check('See https://www.example.com/tours - https://evil.com/x').blocks
    expect(blocks.some((b) => b.code === 'link_host_not_allowed' && b.detail === 'evil.com')).toBe(true)
  })

  it('upper-case schemes and hosts are still read as links', () => {
    expect(check('Pay at HTTPS://EVIL.COM/x').blocks.some((b) => b.detail === 'evil.com')).toBe(true)
  })

  it.each(['evil.de', 'visit x.top today', 'WWW.Evil.Club/pay'])('a bare address (%s) counts as a link', (text) => {
    expect(codes(`Go to ${text}`)).toContain('link_host_not_allowed')
  })

  it('ordinary text with dots is not mistaken for a link', () => {
    expect(codes('Departs at 10.30am, e.g. in March. Mr.Lee will call. Thanks.It was great.')).toEqual([])
  })
})

describe('red-line phrases and leftovers', () => {
  const rules = settingsObj().guardrails

  const cp = (code: number): string => String.fromCodePoint(code) // written as code points so the invisible characters stay visible in this file
  it.each([
    ['an invisible operator', `vi${cp(0x2063)}sa-free`],
    ['a combining grapheme joiner', `visa${cp(0x034f)}-free`],
    ['a variation selector', `visa-fr${cp(0xfe0f)}ee`],
    ['a tag variation selector', `vi${cp(0xe0150)}sa-free`],
    ['a soft hyphen', `vi${cp(0x00ad)}sa-free`],
  ])('%s inside "visa-free" does not hide it', (_name, text) => {
    const result = evaluateContentGates({ subject: 'Hi', body: `This is ${text} travel`, footer: null, settings: { guardrails: rules }, provider: null, facts: null })
    expect(result.blocks.map((b) => b.ruleId)).toContain('no-visa-free')
  })

  it.each(['Dear [Name],', 'The price is [insert price].', 'Departure [date]', 'Price tbc', 'Price TBD today', 'See (TBC)'])('leftover marker: %s', (body) => {
    expect(codes(body)).toContain('placeholder_left')
  })

  it.each(['The tour (15 days) is lovely', 'See note [1]', 'Cost is as per the itinerary'])('ordinary text is fine: %s', (body) => {
    expect(codes(body)).toEqual([])
  })
})

describe('the same rules on a template that has no content source, and on a free-written email', () => {
  const badLink = 'See https://example.com/tours/china/discovery/gone'
  const noSourceTemplate = template({ templateKey: 'thanks', version: 1, factSource: 'none', pickMode: 'none', subject: 'Thanks', body: `Kia ora {{first_name}} ${badLink}` })

  const preArgs = (over: Partial<PreLockArgs> = {}): PreLockArgs => ({
    clientId: 'client-a',
    contactId: 'contact-1',
    sentByEmail: 'lisa@client.co.nz',
    config: config(),
    subject: 'Thanks',
    body: `Kia ora Amy ${badLink}`,
    footer: null,
    template: { key: 'thanks', version: 1, catalogVersion: null, picks: [], inputs: {}, callBasis: 'none' },
    to: 'amy@gmail.com',
    now: NOW,
    ...over,
  })

  const dataWith = (tpl = noSourceTemplate) =>
    makeData({
      loadTemplate: vi.fn(async () => tpl),
      loadFacts: vi.fn(async () => ({ ok: true as const, version: 7, tours: [live, gone] })),
    })

  it('real send: a no-source template with a taken-down tour link is refused', async () => {
    const result = await createSendGates(dataWith()).preLock(preArgs())
    expect(result).toMatchObject({ ok: false, status: 409, reason: 'tour_page_not_on_sale' })
  })

  it('real send: the same template with a good link goes through (and the catalog was read for the check)', async () => {
    const data = dataWith()
    const result = await createSendGates(data).preLock(preArgs({ body: 'Kia ora Amy https://example.com/tours/china/discovery/essentials' }))
    expect(result.ok).toBe(true)
    expect(data.loadFacts).toHaveBeenCalledTimes(1)
  })

  it('real send: an unreadable catalog stops it instead of skipping the check', async () => {
    const data = makeData({ loadTemplate: vi.fn(async () => noSourceTemplate), loadFacts: vi.fn(async () => ({ ok: false as const, error: 'down' })) })
    expect(await createSendGates(data).preLock(preArgs())).toMatchObject({ ok: false, status: 503, reason: 'catalog_unreadable' })
  })

  it('real send: with no tour-site settings there is nothing to check against, so the catalog is not read', async () => {
    const data = dataWith()
    const result = await createSendGates(data).preLock(preArgs({ config: config({ providers: {} }), body: 'Kia ora Amy' }))
    expect(result.ok).toBe(true)
    expect(data.loadFacts).not.toHaveBeenCalled()
  })

  it('a free-written email gets the same verdict', async () => {
    const result = await createSendGates(dataWith()).preLock(preArgs({ template: null }))
    expect(result).toMatchObject({ ok: false, status: 409, reason: 'tour_page_not_on_sale' })
  })

  it('the preview of the same text shows the same red line', async () => {
    const res = await previewTemplate(
      { clientId: 'client-a', contactId: 'contact-1', sentByEmail: 'lisa@client.co.nz', config: config(), request: { key: 'thanks', picks: [], inputs: {}, callBasis: 'none', body: `Kia ora Amy ${badLink}` }, now: NOW },
      dataWith(),
    )
    expect(res.ok && res.blocks.map((b) => b.code)).toContain('tour_page_not_on_sale')
  })

  it('the preview of a no-source template does not invent a catalog version or things to pick', async () => {
    const res = await previewTemplate(
      { clientId: 'client-a', contactId: 'contact-1', sentByEmail: 'lisa@client.co.nz', config: config(), request: { key: 'thanks', picks: [], inputs: {}, callBasis: 'none' }, now: NOW },
      dataWith(),
    )
    expect(res.ok && res.catalogVersion).toBeNull()
    expect(res.ok && res.options).toEqual([])
  })
})

describe('what a refusal leaves in the receipt', () => {
  it('only the rule ids / codes — never a piece of the mail (a URL, a leftover marker) — while the staff member still sees the detail', async () => {
    const args: PreLockArgs = {
      clientId: 'client-a',
      contactId: 'contact-1',
      sentByEmail: 'lisa@client.co.nz',
      config: config(),
      subject: 'Thanks',
      body: 'Dear [Name], pay at https://evil.com/secret-token-123 now',
      footer: null,
      template: null,
      to: 'amy@gmail.com',
      now: NOW,
    }
    const result = await createSendGates(makeData()).preLock(args)
    expect(result).toMatchObject({ ok: false, status: 409 })
    if (result.ok) return
    expect(result.meta.blockDetail).not.toContain('evil.com')
    expect(result.meta.blockDetail).not.toContain('secret-token')
    expect(result.meta.blockDetail).not.toContain('[Name]')
    expect(result.meta.blockDetail).toMatch(/placeholder_left|link_host_not_allowed/)
  })
})
