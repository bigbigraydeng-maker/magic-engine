// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { ReviewInbox } from './ReviewInbox'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const URL_OK = 'https://ctstours.co.nz/tours/china/signature/grand-tour'
const auto = ['audio_track_present_nonsilent', 'resolution_aspect_ratio_correct', 'subtitle_timing_aligned', 'cover_frame_not_blank_or_placeholder', 'format_is_reel', 'cta_in_first_comment_not_body', 'first_comment_link_has_tracking_params']
  .map(key => ({ key, judge: 'AUTO', outcome: 'PASS', detail: null, source_ref: null }))
const order = { id: 'w1', client_id: 'c1', client_name: 'CTS', status: 'in_review', angle: 'a', rationale_one_liner: 'r', fact_source_url: URL_OK, output: { quality_checklist_auto: auto } }
const click = async (el: Element | undefined) => { await act(async () => { el?.dispatchEvent(new MouseEvent('click', { bubbles: true })) }) }
const btn = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.includes(text))

afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals() })

it('prefills source, one-click all PASS, shows plain-Chinese server error inside the dialog', async () => {
  const post = vi.fn(async () => ({ ok: false, status: 422, json: async () => ({ error: 'checklist factual_claims_have_source requires source_ref' }) }))
  vi.stubGlobal('fetch', vi.fn(async (u: string, init?: { method?: string }) =>
    init?.method === 'POST' ? post() : { ok: true, json: async () => ({ orders: [order] }) }))
  const div = document.body.appendChild(document.createElement('div'))
  await act(async () => { createRoot(div).render(<ReviewInbox />) })
  await click(btn('通过·待发布'))
  const urls = [...document.querySelectorAll('input[placeholder^="来源"]')] as HTMLInputElement[]
  expect(urls.map(i => i.value)).toEqual([URL_OK, URL_OK])
  expect(btn('确定通过')?.hasAttribute('disabled')).toBe(true) // 不会替 PM 默认 PASS
  expect(document.body.textContent).toContain('草稿模式')
  await click(btn('项全部标为通过'))
  expect(btn('确定通过')?.hasAttribute('disabled')).toBe(false)
  await click(btn('确定通过'))
  const modal = document.querySelector('.fixed')
  expect(modal?.textContent).toContain('「事实性主张有来源」这一项要填来源网址')
})
