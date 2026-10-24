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
  template_id?: string | null
  music_file?: string | null
  music_choices?: Array<{ id: string; file: string; mood: string; style: string; energy: string; status: string; clean_until_sec: number; max_video_seconds: number }>
  fact_source_url: string | null
  output: Record<string, unknown>
}
const order: Order = { id: 'w1', client_id: 'c1', client_name: 'CTS', status: 'in_review', angle: 'a', rationale_one_liner: 'r', template_id: 'postcard', music_file: 'music/jade_river_journey.mp3', fact_source_url: URL_OK, output: { quality_checklist_auto: auto } }
const click = async (el: Element | undefined) => { await act(async () => { el?.dispatchEvent(new MouseEvent('click', { bubbles: true })) }) }
const tickListened = async () => { await click(document.querySelector('input[type="checkbox"]') ?? undefined) }
// Expanded checklist: the listened item's PASS radio (first radio of that row).
const passListenedRadio = () => document.querySelector('input[type="radio"][name$="-bgm_listened_no_vocals"]') ?? undefined
const btn = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.includes(text))

afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); posts.length = 0 })

const posts: Array<{ url: string; body: unknown }> = []

const mount = async (
  responses: Array<{ ok: boolean; error?: string }>,
  orderOverride: Partial<Order> = {},
  expand = false,
  musicResponses: Array<{ ok: boolean; error?: string; music_choices?: Order['music_choices'] }> = [],
) => {
  const merged: Order = { ...order, ...orderOverride }
  vi.stubGlobal('fetch', vi.fn(async (u: string, init?: { method?: string; body?: string }) => {
    if (init?.method !== 'POST' && u.endsWith('/music-options')) {
      const r = musicResponses.shift() ?? { ok: true, music_choices: merged.music_choices ?? [] }
      return { ok: r.ok, status: r.ok ? 200 : 503, json: async () => (r.ok ? { music_choices: r.music_choices ?? [] } : { error: r.error }) }
    }
    if (init?.method !== 'POST') return { ok: true, json: async () => ({ orders: [merged] }) }
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
const ONE_CLICK = '我已看过这条片子,同意通过'
const FAIL_AUTO = auto.map(item => item.key === 'audio_track_present_nonsilent' ? { ...item, outcome: 'FAIL' } : item)

it('retries loading music choices after a temporary failure when the reject dialog is reopened', async () => {
  await mount([{ ok: true }], {}, false, [
    { ok: false, error: '音乐列表暂时不可用' },
    { ok: true, music_choices: [] },
  ])

  await click(btn('打回'))
  expect(document.body.textContent).toContain('音乐列表暂时不可用')
  await click(btn('再想想'))
  await click(btn('打回'))

  const musicRequests = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(([url]) => String(url).endsWith('/music-options'))
  expect(musicRequests).toHaveLength(2)
  expect(document.body.textContent).not.toContain('音乐列表暂时不可用')
})

it('shows a separate creative storyboard note without treating it as technical approval', async () => {
  await mount([{ ok: true }], {
    template_id: 'impact',
    output: {
      quality_checklist_auto: auto,
      creative_plan: {
        schema_version: 1,
        hook_tag: 'hook-action',
        hook_beats: 2,
        build_tags: ['scene-one', 'scene-two', 'scene-three', 'scene-four'],
        payoff_tag: 'payoff-reveal',
        payoff_beats: 2,
        planned_scene_count: 6,
        rendered_clip_file_count: 12,
        human_review_required: true,
      },
    },
  })
  expect(document.body.textContent).toContain('模板 · 冲击叙事')
  expect(document.body.textContent).toContain('分镜标签已按顺序执行：开头 → 4 段递进 → 结尾')
  expect(document.body.textContent).toContain('请完整看一遍，确认开头能抓人、镜头动作确有变化、结尾兑现主题，音乐和节奏也合适')
  expect(document.body.textContent).not.toContain('创意审核通过')
})

it('prefills source, one-click all PASS, shows plain-Chinese server error inside the dialog', async () => {
  await mount([{ ok: false, error: MISSING }], {}, true)
  const urls = [...document.querySelectorAll('input[placeholder^="来源"]')] as HTMLInputElement[]
  expect(urls.map(i => i.value)).toEqual([URL_OK, URL_OK])
  expect(btn('确定通过')?.hasAttribute('disabled')).toBe(true) // 不会替 PM 默认 PASS
  expect(document.body.textContent).toContain('只存成草稿')
  await click(btn('项全部标为通过'))
  expect(btn('确定通过')?.hasAttribute('disabled')).toBe(true) // bulk pass never ticks "listened"
  await click(passListenedRadio())
  expect(btn('确定通过')?.hasAttribute('disabled')).toBe(false)
  await click(btn('确定通过'))
  expect(document.querySelector('.fixed')?.textContent).toContain('「事实性主张有来源」这一项要填来源网址')
})

it('clears the old error when a retry succeeds (no stale red text on the page)', async () => {
  await mount([{ ok: false, error: MISSING }, { ok: true }], {}, true)
  await click(btn('项全部标为通过'))
  await click(passListenedRadio())
  await click(btn('确定通过'))
  expect(document.body.textContent).toContain('这一项要填来源网址')
  await click(btn('确定通过'))
  expect(document.querySelector('.fixed')).toBeNull()
  expect(document.body.textContent).not.toContain('这一项要填来源网址')
})

it('clean order: one-click panel needs the listened tick, then sends 10 HUMAN PASS items with prefilled source', async () => {
  await mount([{ ok: true }])
  expect(btn('确定通过')).toBeUndefined()
  expect(btn(ONE_CLICK)).toBeDefined()
  expect(btn(ONE_CLICK)?.hasAttribute('disabled')).toBe(true) // not pre-ticked
  await click(btn(ONE_CLICK))
  expect(reviewPosts()).toHaveLength(0) // a disabled button posts nothing
  await tickListened()
  expect(btn(ONE_CLICK)?.hasAttribute('disabled')).toBe(false)
  await click(btn(ONE_CLICK))
  const sent = reviewPosts()
  expect(sent).toHaveLength(1)
  const body = sent[0].body as { action: string; checklist_human: Array<{ key: string; judge: string; outcome: string; source_ref: string | null }> }
  expect(body.action).toBe('approve')
  expect(body.checklist_human).toHaveLength(10)
  expect(body.checklist_human.some(i => i.key === 'bgm_listened_no_vocals' && i.outcome === 'PASS')).toBe(true)
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

it('legacy narrator_voice_mismatch flag is hidden and no longer blocks one-click', async () => {
  await mount([{ ok: true }], { output: { quality_checklist_auto: auto, quality_flags: [{ category: 'narrator_voice_mismatch', detail: 'd' }] } })
  expect(document.body.textContent).not.toContain('人称口吻')
  expect(btn('PM 已接受')).toBeUndefined()
  expect(btn(ONE_CLICK)).toBeDefined()
})

it('legacy narrator flag + real competitor flag: only the real one shows and it still blocks one-click', async () => {
  await mount([{ ok: true }], { output: { quality_checklist_auto: auto, quality_flags: [{ category: 'narrator_voice_mismatch', detail: 'old-voice' }, { category: 'competitor_brand', detail: 'real-flag' }] } })
  expect(document.body.textContent).toContain('real-flag')
  expect(document.body.textContent).not.toContain('old-voice')
  expect(btn(ONE_CLICK)).toBeUndefined()
})

it.each(['placeholder_caption', 'quality_check_unavailable'])('quality flag %s stays visible and blocks one-click', async (category) => {
  await mount([{ ok: true }], { output: { quality_checklist_auto: auto, quality_flags: [{ category, detail: 'shown-detail' }] } })
  expect(document.body.textContent).toContain('shown-detail')
  expect(btn(ONE_CLICK)).toBeUndefined()
})

it('real quality flag stays visible: no PM 已接受 button, no one-click', async () => {
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

it('shows the template and music that the worker actually used', async () => {
  await mountOrders([order])
  expect(document.body.textContent).toContain('模板 · 场景明信片')
  expect(document.body.textContent).toContain('BGM · jade_river_journey.mp3')
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

const btnEq = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === text)
const openReject = async () => { await click(btnEq('再想想')); await click(btnEq('打回')) }

it('打回 needs a reason, posts reject_quality, and shows the 已打回 notice', async () => {
  await mount([{ ok: true }])
  await openReject()
  await click(btn('确认打回'))
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('请至少选一条打回理由')
  expect(reviewPosts()).toHaveLength(0)
  const chip = [...document.querySelectorAll('label')].find(l => l.textContent?.includes('字幕太长或太小'))
  await click(chip?.querySelector('input') ?? undefined)
  await click(btn('确认打回'))
  expect(reviewPosts()).toHaveLength(1)
  const body = reviewPosts()[0].body as { action: string; feedback: string }
  expect(body.action).toBe('reject_quality')
  expect(body.feedback).toContain('字幕太长或太小')
  expect(document.body.textContent).toContain('已打回 #w1')
})

it('lets the reviewer choose a safe alternate BGM for the reopened render', async () => {
  await mount([{ ok: true }], {
    music_file: 'music/pipa-trap.m4a',
    music_choices: [{ id: 'horizons-call', file: "Horizon's Call.mp3", mood: '开阔、期待', style: 'light', energy: 'mid', status: 'beats_unverified', clean_until_sec: 21, max_video_seconds: 20 }],
  })
  await openReject()
  const selector = document.querySelector('#reject-music-choice') as HTMLSelectElement
  expect(selector).toBeDefined()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(selector, 'horizons-call')
    selector.dispatchEvent(new Event('change', { bubbles: true }))
  })
  const reason = [...document.querySelectorAll('label')].find(l => l.textContent?.includes('字幕太长或太小'))
  await click(reason?.querySelector('input') ?? undefined)
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('不会预先试听')
  await click(btn('确认打回'))
  expect(reviewPosts()[0].body).toMatchObject({ action: 'reject_quality', music_id: 'horizons-call' })
})

it('只改预算 tab posts reject_budget', async () => {
  await mount([{ ok: true }])
  await openReject()
  await click(btnEq('只改预算(不打回)'))
  const input = document.querySelector('input[type="number"]') as HTMLInputElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '20')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await click(btn('确认调整预算'))
  expect(reviewPosts()[0].body).toEqual({ action: 'reject_budget', new_budget_usd: 20 })
})

it('card shows short title and hides engineering notes inside 详情; no Claude chat', async () => {
  await mount([], { client_name: 'CTS', angle: 'Grand Tour #3: 钩子', rationale_one_liner: 'v2 loudness 74 window' })
  expect(document.body.textContent).toContain('CTS｜Grand Tour｜第3条｜v2')
  expect(document.body.textContent).not.toContain('问 Claude')
  const details = [...document.querySelectorAll('details')].find(d => d.textContent?.includes('loudness 74'))
  expect(details?.querySelector('summary')?.textContent).toBe('详情')
})
