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

it('复核通过、等你认：显示骨架和表现，点认发出请求并显示谁记下的', async () => {
  await mount({ winners: [{ ...WINNER, program_check: { state: 'passed', at: '2026-11-04T12:46:39.651Z', reason: null } }], pm_only: false, viewer_role: 'magic_lab' })
  const text = document.body.textContent ?? ''
  expect(text).toContain('当前广告样板（赢家）')
  expect(text).toContain('等你认')
  expect(text).toContain('每个 NZ$4.57')
  expect(text).toContain('截图还没传上来')
  expect(document.querySelector('input[type="checkbox"]')).toBeNull()
  await click(btn('认'))
  await flush()
  const post = calls.find((c) => c.method === 'POST')
  expect(post?.url).toBe('/api/factory/winners/w1/decision')
  expect(post?.body).toEqual({ decision: 'approved' })
  expect(document.body.textContent).toContain('已记下：认，记录人 pm@magiclab.example')
})

it('复核没完成 → 如实写「拿不到原视频，这条现在不能用」，不给认按钮', async () => {
  await mount({ winners: [{ ...WINNER, state: 'unusable', reason: 'program_check_not_passed' }], pm_only: false, viewer_role: 'magic_lab' })
  const text = document.body.textContent ?? ''
  expect(text).toContain('复核没完成：拿不到原视频，这条现在不能用')
  expect(text).not.toContain('source_video_unavailable')
  expect(btn('认')).toBeUndefined()
  expect(btn('不认')).toBeUndefined()
})

it('只认 PM 的客户有提示；复核中 / 不可用的不给按钮', async () => {
  await mount({
    winners: [
      { ...WINNER, id: 'a', state: 'needs_check', program_check: null },
      { ...WINNER, id: 'b', state: 'unusable', reason: 'program_check_not_passed', program_check: null },
    ],
    pm_only: true,
    viewer_role: 'client_staff',
  })
  const text = document.body.textContent ?? ''
  expect(text).toContain('只有 Magic Lab 内部账号能点「认」')
  expect(text).toContain('程序复核没通过，现在不能用')
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

it('客户设置里的「只认 PM」没写上 → 面板标红，说明这条已按只认 PM 处理', async () => {
  await mount({ winners: [WINNER], pm_only: true, pm_only_unsynced: true, viewer_role: 'magic_lab' })
  const text = document.body.textContent ?? ''
  expect(text).toContain('「只认 PM」没有写进客户设置')
  expect(text).toContain('请联系开发')
})

it('点不认后回执带 pm_only_failed → 面板标红', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: { method?: string }) => {
      if (init?.method === 'POST') return { ok: true, status: 200, json: async () => ({ receipt: { by: 'pm@magiclab.example', pm_only_failed: true } }) }
      return { ok: true, status: 200, json: async () => ({ winners: [{ ...WINNER, program_check: { state: 'passed', at: '2026-11-04T12:46:39.651Z', reason: null } }], pm_only: false, viewer_role: 'magic_lab' }) }
    }),
  )
  const div = document.body.appendChild(document.createElement('div'))
  await act(async () => {
    createRoot(div).render(<CurrentWinnerPanel clientId="c1" />)
  })
  await flush()
  await click(btn('不认'))
  await flush()
  expect(document.body.textContent).toContain('「只认 PM」没有写进客户设置')
})

it('认的记录对不上 / 确认人没权限 → 写明请 PM 重新认，并且给认按钮（真的能重新认）', async () => {
  await mount({
    winners: [{ ...WINNER, state: 'needs_confirm', reason: 'confirmer_not_authorized', program_check: { state: 'passed', at: '2026-11-04T12:46:39.651Z', reason: null } }],
    pm_only: true, viewer_role: 'magic_lab',
  })
  expect(document.body.textContent).toContain('请 PM 重新认')
  expect(btn('认')).toBeDefined()
})
