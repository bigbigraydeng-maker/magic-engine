/**
 * 抽屉顶上那条「有客人发来新消息」的提示条。
 *
 * 这一页不会自己刷新，所以这条窄条是顾问唯一会知道「客人刚说了话」的地方。
 * 钉住几件事，每件都有明确的坏结果：
 *  · **没到点不许问** —— 一挂载就 fetch 等于每次打开抽屉都打一次接口，白烧。
 *  · **有消息要摆出来，标题也要带数字** —— 不然切到别的标签页就看不见了。
 *  · **读失败什么都不做** —— 不能因为这条锦上添花的东西在抽屉里立一块红色报错。
 *  · **页面在后台不问** —— 没人看，白问。
 *  · **卸载要还标题、停定时器** —— 不然别的页面顶着一个不属于它的「(3)」。
 */

import React from 'react'
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { NewMessagesBanner } from '../NewMessagesBanner'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const INTERVAL = 30_000

/** 让 fetch 回一个指定结果。返回 mock，供断言查询地址。 */
const stubFetch = (body: unknown, ok = true) => {
  const f = vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => body })
  vi.stubGlobal('fetch', f)
  return f
}

/** 把 visibilityState 钉成指定值。 */
const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  document.title = 'CRM'
  setVisibility('visible')
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('新消息提示条', () => {
  it('卸载时标题已被别的页面改写 → 不许盖掉它（只在还是我们设的值时才还原）', async () => {
    stubFetch({ count: 2, byChannel: { whatsapp: 2 }, latestAt: null })
    const { unmount } = render(<NewMessagesBanner clientId={CLIENT} intervalMs={INTERVAL} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL)
    })
    expect(document.title.startsWith('(2) ')).toBe(true)

    document.title = '别的页面自己的标题 | Magic Engine'
    unmount()
    expect(document.title).toBe('别的页面自己的标题 | Magic Engine')
  })

  it('刚挂载不摆条、也不问 —— 要等第一个间隔', async () => {
    const f = stubFetch({ count: 0, byChannel: {}, latestAt: null })
    const { container } = render(<NewMessagesBanner clientId={CLIENT} intervalMs={INTERVAL} />)

    expect(container).toBeEmptyDOMElement()
    expect(f).not.toHaveBeenCalled()
  })

  it('到点问一次，有消息就摆条、标题带数字', async () => {
    const f = stubFetch({
      count: 3,
      byChannel: { whatsapp: 2, messenger: 1 },
      latestAt: '2026-10-20T00:00:00.000Z',
    })
    render(<NewMessagesBanner clientId={CLIENT} intervalMs={INTERVAL} />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL)
    })

    expect(f).toHaveBeenCalledTimes(1)
    const url = String(f.mock.calls[0][0])
    expect(url).toContain(`/api/clients/${CLIENT}/crm/inbound-pulse`)
    expect(url).toContain('since=')

    const banner = screen.getByTestId('new-messages-banner')
    expect(banner.textContent).toContain('有 3 个对话收到客人新消息')
    expect(banner.textContent).toContain('WhatsApp 2')
    expect(banner.textContent).toContain('私信 1')
    expect(document.title.startsWith('(3) ')).toBe(true)
  })

  it('count 为 0 → 什么都不摆，标题不动', async () => {
    stubFetch({ count: 0, byChannel: {}, latestAt: null })
    const { container } = render(<NewMessagesBanner clientId={CLIENT} intervalMs={INTERVAL} />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL)
    })

    expect(container).toBeEmptyDOMElement()
    expect(document.title).toBe('CRM')
  })

  it('读失败（非 ok / 网络错）→ 不摆条、不抛错', async () => {
    stubFetch({ error: '读取失败' }, false)
    const { container } = render(<NewMessagesBanner clientId={CLIENT} intervalMs={INTERVAL} />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL)
    })
    expect(container).toBeEmptyDOMElement()

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL)
    })
    expect(container).toBeEmptyDOMElement()
  })

  it('页面在后台 → 到点也不问', async () => {
    setVisibility('hidden')
    const f = stubFetch({ count: 1, byChannel: { whatsapp: 1 }, latestAt: null })
    render(<NewMessagesBanner clientId={CLIENT} intervalMs={INTERVAL} />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL)
    })

    expect(f).not.toHaveBeenCalled()
  })

  it('卸载 → 还回原标题、停掉定时器', async () => {
    const f = stubFetch({ count: 2, byChannel: { whatsapp: 2 }, latestAt: null })
    const { unmount } = render(<NewMessagesBanner clientId={CLIENT} intervalMs={INTERVAL} />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL)
    })
    expect(document.title.startsWith('(2) ')).toBe(true)

    unmount()
    expect(document.title).toBe('CRM')

    const callsBefore = f.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL * 3)
    })
    expect(f.mock.calls.length).toBe(callsBefore)
  })

  it('点「刷新」→ 调 window.location.reload', async () => {
    stubFetch({ count: 1, byChannel: { whatsapp: 1 }, latestAt: null })
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })

    render(<NewMessagesBanner clientId={CLIENT} intervalMs={INTERVAL} />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL)
    })

    screen.getByText('刷新页面').click()
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
