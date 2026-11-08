// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { VariantOrderPanel } from './VariantOrderPanel'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const BASE = {
  id: 'b1',
  client_id: 'c1',
  client_name: 'Demo Client',
  status: 'published',
  angle: 'Lake town price-first list reel',
  created_at: '2026-10-20T00:00:00Z',
  template: 'list',
  hook_lines: [
    { text: 'FROM', badge: null },
    { text: 'NZ$1,999', badge: null },
    { text: 'DAYS', badge: '10' },
  ],
  video_url: 'https://example.test/v.mp4',
}

const DETAIL = {
  id: 'b1',
  client_id: 'c1',
  template: 'list',
  hook_lines: BASE.hook_lines,
  current_music: 'music/jade_river_journey.mp3',
  music_choices: [],
  max_hook_chars: 9,
}

const calls: Array<{ url: string; method: string; body: unknown }> = []
let postStatus = 201

const flush = async () => {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

const btn = (text: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(text))

const inputs = () =>
  [...document.querySelectorAll('input:not([type="radio"])')] as HTMLInputElement[]

const setValue = async (el: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const click = async (el: Element | undefined) => {
  await act(async () => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

const mount = async (clientId: string | null = null) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(init.body) : undefined
      calls.push({ url, method, body })

      if (method === 'POST') {
        const status = postStatus
        const payload =
          status === 201
            ? {
                order: {
                  id: 'abcdef12-0000-4000-8000-000000000000',
                  status: 'queued',
                  summary: '开场文字改成「FROM / NZ$1,999 / + FLIGHTS」',
                },
              }
            : { error: '同一个客户 24 小时内最多下 10 单，明天再来' }
        return { ok: status < 300, status, json: async () => payload }
      }

      if (url.includes('?base=')) {
        return { ok: true, status: 200, json: async () => ({ base: DETAIL }) }
      }

      return { ok: true, status: 200, json: async () => ({ bases: [BASE] }) }
    }),
  )

  const div = document.body.appendChild(document.createElement('div'))
  await act(async () => {
    createRoot(div).render(<VariantOrderPanel clientId={clientId} />)
  })

  const details = document.querySelector('details')
  if (details) {
    await act(async () => {
      details.open = true
      details.dispatchEvent(new Event('toggle'))
    })
  }
  await flush()
}

const chooseBase = async () => {
  await click(btn('用它当底稿'))
  await flush()
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  calls.length = 0
  postStatus = 201
})

const musicRadio = () => document.querySelector('input[type="radio"][value="music"]')

it('lists bases after opening and shows the form under the chosen base', async () => {
  await mount()
  expect(document.body.textContent).toContain('Demo Client')
  expect(document.body.textContent).toContain('Lake town price-first')

  await chooseBase()

  const fields = inputs()
  expect(fields[0].value).toBe('FROM')
  expect(fields[2].value).toBe('NZ$1,999')
  expect(fields[4].value).toBe('DAYS')
  expect(fields[5].value).toBe('10')
  expect(musicRadio()).not.toBeNull()
  expect(calls.some((c) => c.method === 'GET' && c.url.includes('?base=b1'))).toBe(true)
})

it('blocks a line that is too wide', async () => {
  await mount()
  await chooseBase()

  await setValue(inputs()[4], 'FLIGHTS INCLUDED')

  expect(document.body.textContent).toContain('太长会折行')
  expect(btn('下单')?.hasAttribute('disabled')).toBe(true)
})

it('posts exactly one change and shows the queued message', async () => {
  await mount()
  await chooseBase()

  await setValue(inputs()[4], '+ FLIGHTS')
  await setValue(inputs()[5], '')

  await click(btn('下单'))
  await flush()

  const posts = calls.filter((c) => c.method === 'POST')
  expect(posts).toHaveLength(1)
  expect(posts[0].body).toEqual({
    base_work_order_id: 'b1',
    change: {
      kind: 'hook',
      lines: [
        { text: 'FROM', badge: '' },
        { text: 'NZ$1,999', badge: '' },
        { text: '+ FLIGHTS', badge: '' },
      ],
    },
    note: '',
  })
  expect(document.body.textContent).toContain('已排队，单号 abcdef12')
  expect(document.body.textContent).toContain('不会自动发布')
})

it('shows the server error', async () => {
  await mount()
  await chooseBase()

  await setValue(inputs()[4], '+ FLIGHTS')
  await setValue(inputs()[5], '')
  postStatus = 429

  await click(btn('下单'))
  await flush()

  expect(document.body.textContent).toContain('最多下 10 单')
})

it('passes the locked client to the list request', async () => {
  await mount('c1')

  const firstGet = calls.find((c) => c.method === 'GET')
  expect(firstGet?.url).toContain('?client=c1')
})

it('music mode with no choices explains why', async () => {
  await mount()
  await chooseBase()

  await click(musicRadio() ?? undefined)

  expect(document.body.textContent).toContain('这条视频没有可换的无人声配乐')
  expect(btn('下单')?.hasAttribute('disabled')).toBe(true)
})
