// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { PromoteReelButton } from './PromoteReelButton'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const posts: Array<{ url: string; body: unknown }> = []

afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); posts.length = 0 })

const click = async (el: Element | undefined) => { await act(async () => { el?.dispatchEvent(new MouseEvent('click', { bubbles: true })) }) }
const btn = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.includes(text))

const PREVIEW = {
  preview_token: 'tok-123',
  page_id: 'page-1',
  video_id: 'vid-9',
  caption: '这是文案',
  first_comment: '这是首评',
  mode: 'publish',
}

const mount = async (
  responses: Array<{ ok: boolean; json: Record<string, unknown> }>,
  onDone?: () => void,
) => {
  vi.stubGlobal('fetch', vi.fn(async (u: string, init?: { method?: string; body?: string }) => {
    posts.push({ url: u, body: init?.body ? JSON.parse(init.body) : undefined })
    const r = responses.shift()!
    return { ok: r.ok, status: r.ok ? 200 : 422, json: async () => r.json }
  }))
  const div = document.body.appendChild(document.createElement('div'))
  await act(async () => { createRoot(div).render(<PromoteReelButton orderId="w1" onDone={onDone} />) })
}

it('idle render shows the promote button', async () => {
  await mount([])
  expect(btn('转为公开发布(单条)')).toBeDefined()
})

it('click triggers the first POST with confirm:false', async () => {
  await mount([{ ok: true, json: PREVIEW }])
  await click(btn('转为公开发布(单条)'))
  expect(posts).toHaveLength(1)
  expect(posts[0].url).toBe('/api/factory/work-orders/w1/promote')
  expect(posts[0].body).toEqual({ confirm: false })
})

it('preview panel shows caption and first_comment', async () => {
  await mount([{ ok: true, json: PREVIEW }])
  await click(btn('转为公开发布(单条)'))
  expect(document.body.textContent).toContain('这是文案')
  expect(document.body.textContent).toContain('这是首评')
  expect(document.body.textContent).toContain('page-1')
  expect(document.body.textContent).toContain('vid-9')
  expect(document.body.textContent).toContain('确认后这条 Reel 会立刻对外公开,不能改回草稿(只能删帖)')
})

it('confirm sends confirm:true with the token returned', async () => {
  const onDone = vi.fn()
  await mount([{ ok: true, json: PREVIEW }, { ok: true, json: {} }], onDone)
  await click(btn('转为公开发布(单条)'))
  await click(btn('确认公开'))
  expect(posts).toHaveLength(2)
  expect(posts[1].body).toEqual({ confirm: true, preview_token: 'tok-123' })
  expect(document.body.textContent).toContain('已转为公开')
  expect(onDone).toHaveBeenCalledTimes(1)
})

it('error response shows the error text', async () => {
  await mount([{ ok: false, json: { error: '权限不足' } }])
  await click(btn('转为公开发布(单条)'))
  expect(document.body.textContent).toContain('权限不足')
  expect(btn('转为公开发布(单条)')).toBeDefined()
})

it('sync_only note appears', async () => {
  await mount([{ ok: true, json: { ...PREVIEW, mode: 'sync_only' } }])
  await click(btn('转为公开发布(单条)'))
  expect(document.body.textContent).toContain('这条在 Facebook 上已经是公开的,只会同步记录,不会再发布一次')
})

it('cancel returns to idle without a second POST', async () => {
  await mount([{ ok: true, json: PREVIEW }])
  await click(btn('转为公开发布(单条)'))
  await click(btn('取消'))
  expect(posts).toHaveLength(1)
  expect(btn('转为公开发布(单条)')).toBeDefined()
  expect(btn('确认公开')).toBeUndefined()
})

it('first_comment_status failed warning appears', async () => {
  await mount([{ ok: true, json: PREVIEW }, { ok: true, json: { first_comment_status: 'failed' } }])
  await click(btn('转为公开发布(单条)'))
  await click(btn('确认公开'))
  expect(document.body.textContent).toContain('已转为公开')
  expect(document.body.textContent).toContain('首评没发成功,请联系开发处理')
})
