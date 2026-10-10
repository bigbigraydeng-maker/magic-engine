// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { ReviewInbox } from './ReviewInbox'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const URL_OK = 'https://ctstours.co.nz/tours/china/signature/grand-tour'
const auto = ['audio_track_present_nonsilent', 'resolution_aspect_ratio_correct', 'subtitle_timing_aligned', 'cover_frame_not_blank_or_placeholder', 'format_is_reel', 'cta_in_first_comment_not_body', 'first_comment_link_has_tracking_params']
  .map(key => ({ key, judge: 'AUTO', outcome: 'PASS', detail: null, source_ref: null }))
interface Order {
  id: string; client_id: string; client_name: string; status: string; angle: string; rationale_one_liner: string
  fact_source_url: string | null
  output: Record<string, unknown>
  accepted_flags?: Array<{ category: string; accepted_at: string; accepted_by: string }>
}
const order: Order = { id: 'w1', client_id: 'c1', client_name: 'CTS', status: 'in_review', angle: 'a', rationale_one_liner: 'r', fact_source_url: URL_OK, output: { quality_checklist_auto: auto } }
const click = async (el: Element | undefined) => { await act(async () => { el?.dispatchEvent(new MouseEvent('click', { bubbles: true })) }) }
const btn = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.includes(text))

afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); posts.length = 0 })

const posts: Array<{ url: string; body: unknown }> = []

const mount = async (
  responses: Array<{ ok: boolean; error?: string }>,
  orderOverride: Partial<Order> = {},
  expand = false,
  acceptedFlagsError?: string,
) => {
  const merged: Order = { ...order, ...orderOverride }
  vi.stubGlobal('fetch', vi.fn(async (u: string, init?: { method?: string; body?: string }) => {
    if (init?.method !== 'POST') return { ok: true, json: async () => ({ orders: [merged], accepted_flags_error: acceptedFlagsError ?? null }) }
    posts.push({ url: u, body: init.body ? JSON.parse(init.body) : undefined })
    const r = responses.shift()!
    return { ok: r.ok, status: r.ok ? 200 : 422, json: async () => (r.ok ? {} : { error: r.error }) }
  }))
  const div = document.body.appendChild(document.createElement('div'))
  await act(async () => { createRoot(div).render(<ReviewInbox />) })
  await click(btn('通过·待发布'))
  if (expand) await click(btn('展开逐项核对'))
}
const MISSING = 'checklist factual_claims_have_source requires source_ref'

const reviewPosts = () => posts.filter(p => p.url === '/api/factory/work-orders/w1/review')
const acceptPosts = () => posts.filter(p => p.url === '/api/factory/work-orders/w1/accept-flag')
const ONE_CLICK = '我已看过这条片子,同意通过'
const FAIL_AUTO = auto.map(item => item.key === 'audio_track_present_nonsilent' ? { ...item, outcome: 'FAIL' } : item)

it('prefills source, one-click all PASS, shows plain-Chinese server error inside the dialog', async () => {
  await mount([{ ok: false, error: MISSING }], {}, true)
  const urls = [...document.querySelectorAll('input[placeholder^="来源"]')] as HTMLInputElement[]
  expect(urls.map(i => i.value)).toEqual([URL_OK, URL_OK])
  expect(btn('确定通过')?.hasAttribute('disabled')).toBe(true) // 不会替 PM 默认 PASS
  expect(document.body.textContent).toContain('只存成草稿')
  await click(btn('项全部标为通过'))
  expect(btn('确定通过')?.hasAttribute('disabled')).toBe(false)
  await click(btn('确定通过'))
  expect(document.querySelector('.fixed')?.textContent).toContain('「事实性主张有来源」这一项要填来源网址')
})

it('clears the old error when a retry succeeds (no stale red text on the page)', async () => {
  await mount([{ ok: false, error: MISSING }, { ok: true }], {}, true)
  await click(btn('项全部标为通过'))
  await click(btn('确定通过'))
  expect(document.body.textContent).toContain('这一项要填来源网址')
  await click(btn('确定通过'))
  expect(document.querySelector('.fixed')).toBeNull()
  expect(document.body.textContent).not.toContain('这一项要填来源网址')
})

it('clean order: one-click panel, no 确定通过, sends 9 HUMAN PASS items with prefilled source', async () => {
  await mount([{ ok: true }])
  expect(btn('确定通过')).toBeUndefined()
  expect(btn(ONE_CLICK)).toBeDefined()
  await click(btn(ONE_CLICK))
  const sent = reviewPosts()
  expect(sent).toHaveLength(1)
  const body = sent[0].body as { action: string; checklist_human: Array<{ key: string; judge: string; outcome: string; source_ref: string | null }> }
  expect(body.action).toBe('approve')
  expect(body.checklist_human).toHaveLength(9)
  expect(body.checklist_human.every(i => i.outcome === 'PASS' && i.judge === 'HUMAN')).toBe(true)
  const facts = body.checklist_human.filter(i => i.key.startsWith('factual_'))
  expect(facts.map(i => i.source_ref)).toEqual([URL_OK, URL_OK])
  expect(document.querySelector('.fixed')).toBeNull()
})

it('AUTO checklist with a FAIL: no one-click, shows reasons, 确定通过 disabled', async () => {
  await mount([{ ok: true }], { output: { quality_checklist_auto: FAIL_AUTO } })
  expect(btn(ONE_CLICK)).toBeUndefined()
  expect(document.body.textContent).toContain('不能一键通过')
  expect(document.body.textContent).toContain('自动媒体检测未通过')
  expect(btn('确定通过')?.hasAttribute('disabled')).toBe(true)
})

it('redline hits: no one-click, shows redline reason', async () => {
  await mount([{ ok: true }], { output: { quality_checklist_auto: auto, redline_hits: ['x'] } })
  expect(btn(ONE_CLICK)).toBeUndefined()
  expect(document.body.textContent).toContain('文案命中品牌红线')
})

it('acceptable quality flag: PM 已接受 button POSTs the category', async () => {
  await mount([{ ok: true }], { output: { quality_checklist_auto: auto, quality_flags: [{ category: 'narrator_voice_mismatch', detail: 'd' }] } })
  expect(btn(ONE_CLICK)).toBeUndefined()
  await click(btn('PM 已接受'))
  const sent = acceptPosts()
  expect(sent).toHaveLength(1)
  expect(sent[0].body).toEqual({ category: 'narrator_voice_mismatch' })
})

it('accepted flag: shows 已接受 date, no PM 已接受 button, one-click available', async () => {
  await mount([{ ok: true }], {
    output: { quality_checklist_auto: auto, quality_flags: [{ category: 'narrator_voice_mismatch', detail: 'd' }] },
    accepted_flags: [{ category: 'narrator_voice_mismatch', accepted_at: '2026-10-06T00:00:00Z', accepted_by: 'pm' }],
  })
  expect(document.body.textContent).toContain('已接受(2026-10-06)')
  expect(btn('PM 已接受')).toBeUndefined()
  expect(btn(ONE_CLICK)).toBeDefined()
})

it('non-acceptable quality flag: no PM 已接受 button, no one-click', async () => {
  await mount([{ ok: true }], { output: { quality_checklist_auto: auto, quality_flags: [{ category: 'competitor_brand', detail: 'd' }] } })
  expect(btn('PM 已接受')).toBeUndefined()
  expect(btn(ONE_CLICK)).toBeUndefined()
})

it('missing fact_source_url: no one-click, shows prefilled-source reason', async () => {
  await mount([{ ok: true }], { fact_source_url: null })
  expect(btn(ONE_CLICK)).toBeUndefined()
  expect(document.body.textContent).toContain('来源网址没有预填')
})

it('one-click panel links to the prefilled source URL', async () => {
  await mount([{ ok: true }])
  const link = document.querySelector('a') as HTMLAnchorElement | null
  expect(link?.getAttribute('href')).toBe(URL_OK)
})

it('quality flag with no detail at all still blocks one-click', async () => {
  await mount([{ ok: true }], { output: { quality_checklist_auto: auto, quality_flags: [{ category: 'competitor_brand' }] } })
  expect(btn(ONE_CLICK)).toBeUndefined()
})

it('accepted_flags_error surfaces a red notice with the message', async () => {
  await mount([{ ok: true }], {}, false, 'boom')
  expect(document.body.textContent).toContain('读取失败')
  expect(document.body.textContent).toContain('boom')
})

const mountOrders = async (orders: unknown[]) => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ orders }) })))
  const div = document.body.appendChild(document.createElement('div'))
  await act(async () => { createRoot(div).render(<ReviewInbox />) })
}

it('shows a download link only when the order has a video_path', async () => {
  await mountOrders([
    { ...order, output: { ...order.output, video_path: 'x/y.mp4' } },
    { ...order, id: 'w2', output: { ...order.output } },
  ])
  const links = [...document.querySelectorAll('a')].filter(a => a.textContent === '下载成片') as HTMLAnchorElement[]
  expect(links).toHaveLength(1)
  expect(links[0].href.endsWith('/content-factory/x/y.mp4?download=w1.mp4')).toBe(true)
})

it('renders the publish outlets disclosure with the outlet list', async () => {
  await mountOrders([{ ...order, output: { ...order.output, video_path: 'x/y.mp4' } }])
  expect(document.body.textContent).toContain('通过后会去哪里?')
  const details = document.querySelector('details') as HTMLDetailsElement
  await act(async () => { details.open = true })
  expect(document.body.textContent).toContain('Instagram')
  expect(document.body.textContent).toContain('未接通')
  expect(document.body.textContent).toContain('Facebook 主页 Reel')
})
