import { describe, expect, it } from 'vitest'
import {
  AutoSendNotConnectedError,
  createLiveAdapter,
  isNotConnectedError,
  loadErrorText,
} from '../adapter'

describe('createLiveAdapter (真实数据还没接通)', () => {
  it('reports "not connected" for both reads and never returns an empty result', async () => {
    const adapter = createLiveAdapter('client-1')
    await expect(adapter.loadOverview()).rejects.toBeInstanceOf(AutoSendNotConnectedError)
    await expect(adapter.loadLetterDetail('any-letter')).rejects.toBeInstanceOf(AutoSendNotConnectedError)
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
