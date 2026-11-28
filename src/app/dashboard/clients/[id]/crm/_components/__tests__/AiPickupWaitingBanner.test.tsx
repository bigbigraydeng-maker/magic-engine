/**
 * The narrow bar at the top of the drawer: "guests are waiting for you to release
 * them to AI".
 *
 * Pinned behaviours, each with a concrete bad outcome:
 *  · **Shows the count and the days** — otherwise the bar says nothing useful.
 *  · **"Never released" vs "N days" vs "released today"** — the tail must match the data.
 *  · **Zero waiting → nothing** — no empty bar.
 *  · **Read failure → nothing** — no red error in the drawer.
 */

import React from 'react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { AiPickupWaitingBanner } from '../AiPickupWaitingBanner'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'

/** Make fetch return a fixed result. Returns the mock so we can assert on the URL. */
const stubFetch = (body: unknown, ok = true) => {
  const f = vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => body })
  vi.stubGlobal('fetch', f)
  return f
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('AI 放行等待提示条', () => {
  it('有 12 位在等、14 天没人放行 → 摆条、带数字和天数、链接指向放行页', async () => {
    const f = stubFetch({ waiting: 12, readyToday: 12, daysSinceRelease: 14 })
    render(<AiPickupWaitingBanner clientId={CLIENT} />)

    const banner = await screen.findByTestId('ai-pickup-waiting-banner')
    expect(banner.textContent).toContain('今天有 12 位客人等你点发送 2027 目录')
    expect(banner.textContent).toContain('已经 14 天没有人放行了。')

    const link = banner.querySelector('a')
    expect(link).not.toBeNull()
    expect(link?.getAttribute('href')).toBe(`/dashboard/clients/${CLIENT}/crm/ai-pickup`)

    expect(f).toHaveBeenCalledTimes(1)
    expect(String(f.mock.calls[0][0])).toBe(`/api/clients/${CLIENT}/crm/ai-pickup/waiting`)
  })

  it('从来没有人放行过 → 尾巴是「还从来没有人放行过。」', async () => {
    stubFetch({ waiting: 3, readyToday: 3, daysSinceRelease: null })
    render(<AiPickupWaitingBanner clientId={CLIENT} />)

    const banner = await screen.findByTestId('ai-pickup-waiting-banner')
    expect(banner.textContent).toContain('还从来没有人放行过。')
  })

  it('今天刚放行过（0 天）→ 摆条，但不提「没有人放行」', async () => {
    stubFetch({ waiting: 5, readyToday: 5, daysSinceRelease: 0 })
    render(<AiPickupWaitingBanner clientId={CLIENT} />)

    const banner = await screen.findByTestId('ai-pickup-waiting-banner')
    expect(banner.textContent).toContain('今天有 5 位客人等你点发送 2027 目录')
    expect(banner.textContent).not.toContain('没有人放行')
  })

  it('waiting 为 0 → 什么都不摆', async () => {
    const f = stubFetch({ waiting: 0, readyToday: 0, daysSinceRelease: null })
    render(<AiPickupWaitingBanner clientId={CLIENT} />)

    await waitFor(() => expect(f).toHaveBeenCalled())
    expect(screen.queryByTestId('ai-pickup-waiting-banner')).toBeNull()
  })

  it('排着 200 位、今天还能发 30 位 → 写今天的 30 位，并说后面还排着 170 位', async () => {
    stubFetch({ waiting: 200, readyToday: 30, daysSinceRelease: 13 })
    render(<AiPickupWaitingBanner clientId={CLIENT} />)
    const banner = await screen.findByTestId('ai-pickup-waiting-banner')
    expect(banner.textContent).toContain('今天有 30 位客人等你点发送 2027 目录')
    expect(banner.textContent).toContain('后面还排着 170 位')
  })

  it('今天的名额已经发完（还有人排队）→ 不摆条：没有人现在能放行，摆着只会被无视', async () => {
    const f = stubFetch({ waiting: 170, readyToday: 0, daysSinceRelease: 0 })
    render(<AiPickupWaitingBanner clientId={CLIENT} />)
    await waitFor(() => expect(f).toHaveBeenCalled())
    await Promise.resolve()
    expect(screen.queryByTestId('ai-pickup-waiting-banner')).toBeNull()
  })

  it('读失败（非 ok）→ 什么都不摆', async () => {
    const f = stubFetch({ error: '读取失败' }, false)
    render(<AiPickupWaitingBanner clientId={CLIENT} />)

    await waitFor(() => expect(f).toHaveBeenCalled())
    expect(screen.queryByTestId('ai-pickup-waiting-banner')).toBeNull()
  })

  it('网络错 → 什么都不摆、不抛错', async () => {
    const f = vi.fn().mockRejectedValue(new Error('network'))
    vi.stubGlobal('fetch', f)
    render(<AiPickupWaitingBanner clientId={CLIENT} />)

    await waitFor(() => expect(f).toHaveBeenCalled())
    expect(screen.queryByTestId('ai-pickup-waiting-banner')).toBeNull()
  })
})
