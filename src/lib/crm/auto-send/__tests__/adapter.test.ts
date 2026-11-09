import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AutoSendNotConnectedError,
  createLiveAdapter,
  isNotConnectedError,
  loadErrorText,
} from '../adapter'

describe('createLiveAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads the real interface (the auto-letters read route), not a stub', async () => {
    const fetchMock = vi.fn(async (_url: string) =>
      new Response(
        JSON.stringify({ generatedAt: 'x', nextBatch: null, depositLetters: [], scheduledLetters: [], totalDistinctLetters: 0 }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    await expect(createLiveAdapter('client-1').loadOverview()).resolves.toEqual({ nextBatch: null, sections: [] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/clients/client-1/crm/auto-letters')
  })

  it('has read methods only: nothing that could send or release', () => {
    expect(Object.keys(createLiveAdapter('client-1')).sort()).toEqual(['loadLetterDetail', 'loadOverview'])
  })
})

describe('isNotConnectedError', () => {
  it('is true only for the not-connected error', () => {
    expect(isNotConnectedError(new AutoSendNotConnectedError())).toBe(true)
    expect(isNotConnectedError(new Error('x'))).toBe(false)
    expect(isNotConnectedError('not connected')).toBe(false)
    expect(isNotConnectedError(null)).toBe(false)
  })
})

describe('loadErrorText', () => {
  it('passes a Chinese sentence through', () => {
    expect(loadErrorText(new Error('服务器没有返回原因'))).toBe('服务器没有返回原因')
  })

  it('never shows technical or English messages', () => {
    expect(loadErrorText(new Error('Failed to fetch'))).toBe('网络出错')
    expect(loadErrorText(new TypeError('NetworkError when attempting to fetch resource.'))).toBe('网络出错')
    expect(loadErrorText(new Error(''))).toBe('网络出错')
  })

  it('handles values that are not errors', () => {
    expect(loadErrorText('boom')).toBe('网络出错')
    expect(loadErrorText(undefined)).toBe('网络出错')
    expect(loadErrorText({ message: '中文但不是 Error' })).toBe('网络出错')
  })
})
