// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { CurrentWinnerPanel } from './CurrentWinnerPanel'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const WINNER = {
  id: 'w1',
  state: 'needs_confirm',
  reason: 'pm_decision_missing',
  hook: '第一个画面就是价格卡',
  middle: '三个景点各配一项包含',
  cta: '结尾再报一次价格',
  tags: ['price_first_frame'],
  performance: { spend: 530.02, results: 116, cost_per_result: 4.57, ctr_pct: 5.45, period: '2026-10-30..2026-11-04' },
  frames: [],
  program_check: { state: 'needs_human', at: '2026-11-04T12:46:39.651Z', reason: 'source_video_unavailable' },
  decision: null,
}

const calls: Array<{ url: string; method: string; body: unknown }> = []

const flush = async () => {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

const btn = (text: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)

const click = async (el: Element | undefined) => {
  await act(async () => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

const mount = async (board: Record<string, unknown>) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? 'GET'
      calls.push({ url, method, body: init?.body ? JSON.parse(init.body) : undefined })
      if (method === 'POST') return { ok: true, status: 200, json: async () => ({ receipt: { by: 'pm@magiclab.example' } }) }
      return { ok: true, status: 200, json: async () => board }
    }),
  )
  const div = document.body.appendChild(document.createElement('div'))
  await act(async () => {
    createRoot(div).render(<CurrentWinnerPanel clientId="c1" />)
  })
  await flush()
}

afterEach(() => {
  document.body.innerHTML = ''
  calls.length = 0
  vi.unstubAllGlobals()
})

it('显示骨架、表现和「等你认」；复核没完成时不勾「看过截图」就点不了认', async () => {
  await mount({ winners: [WINNER], pm_only: false, viewer_role: 'magic_lab' })
  const text = document.body.textContent ?? ''
  expect(text).toContain('当前广告样板（赢家）')
  expect(text).toContain('等你认')
  expect(text).toContain('复核没完成：拿不到原视频')
  expect(text).not.toContain('source_video_unavailable')
  expect(text).toContain('每个 NZ$4.57')
  expect(text).toContain('截图还没传上来')
  expect(btn('认')?.hasAttribute('disabled')).toBe(true)

  const tick = document.querySelector('input[type="checkbox"]')
  await click(tick ?? undefined)
  expect(btn('认')?.hasAttribute('disabled')).toBe(false)
  await click(btn('认'))
  await flush()

  const post = calls.find((c) => c.method === 'POST')
  expect(post?.url).toBe('/api/factory/winners/w1/decision')
  expect(post?.body).toEqual({ decision: 'approved' })
  expect(document.body.textContent).toContain('已记下：认，记录人 pm@magiclab.example')
})

it('只认 PM 的客户有提示；复核中 / 不可用的不给按钮', async () => {
  await mount({
    winners: [
      { ...WINNER, id: 'a', state: 'needs_check', program_check: null },
      { ...WINNER, id: 'b', state: 'unusable', reason: 'receipt_invalid', program_check: null },
    ],
    pm_only: true,
    viewer_role: 'client_staff',
  })
  const text = document.body.textContent ?? ''
  expect(text).toContain('只有 Magic Lab 内部账号能点「认」')
  expect(text).toContain('确认记录对不上，要重新认')
  expect(btn('认')).toBeUndefined()
  expect(btn('不认')).toBeUndefined()
})

it('没有客户时不渲染', async () => {
  const div = document.body.appendChild(document.createElement('div'))
  await act(async () => {
    createRoot(div).render(<CurrentWinnerPanel clientId={null} />)
  })
  expect(div.innerHTML).toBe('')
})
