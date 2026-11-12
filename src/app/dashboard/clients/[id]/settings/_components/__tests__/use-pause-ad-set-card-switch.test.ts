import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { usePauseAdSetCardSwitch } from '../use-pause-ad-set-card-switch'

const CLIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const BASE = `/api/clients/${CLIENT_ID}/ad-strategy-config/pause-ad-set-card`

function mockFetchSequence(responses: Array<{ status?: number; json: unknown }>) {
  let i = 0
  const fetchMock = vi.fn(async () => {
    const r = responses[Math.min(i, responses.length - 1)]
    i += 1
    const status = r.status ?? 200
    return new Response(JSON.stringify(r.json), { status })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('usePauseAdSetCardSwitch', () => {
  it('loads enabled from GET', async () => {
    const fetchMock = mockFetchSequence([{ json: { enabled: true } }])
    const { result } = renderHook(() => usePauseAdSetCardSwitch(CLIENT_ID))

    await waitFor(() => expect(result.current.phase).toBe('ready'))
    expect(result.current.enabled).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(BASE, { cache: 'no-store' })
  })

  it('POST toggle sends enabled body and keeps server value', async () => {
    const fetchMock = mockFetchSequence([
      { json: { enabled: false } },
      { json: { enabled: true } },
    ])
    const { result } = renderHook(() => usePauseAdSetCardSwitch(CLIENT_ID))
    await waitFor(() => expect(result.current.phase).toBe('ready'))

    await act(async () => {
      await result.current.toggle(true)
    })

    expect(fetchMock).toHaveBeenLastCalledWith(
      BASE,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ enabled: true }),
      }),
    )
    expect(result.current.enabled).toBe(true)
  })

  it('403 on save → shows API message and reverts enabled', async () => {
    mockFetchSequence([
      { json: { enabled: true } },
      { status: 403, json: { error: '你不能改这个开关。' } },
    ])
    const { result } = renderHook(() => usePauseAdSetCardSwitch(CLIENT_ID))
    await waitFor(() => expect(result.current.phase).toBe('ready'))

    await act(async () => {
      await result.current.toggle(false)
    })

    await waitFor(() => {
      expect(result.current.saveError).toBe('你不能改这个开关。')
    })
    expect(result.current.enabled).toBe(true)
  })
})
