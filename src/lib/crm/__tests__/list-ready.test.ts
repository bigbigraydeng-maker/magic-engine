import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { afterCrmListReady, expectCrmList, markCrmListReady } from '../list-ready'

let leavePage: (() => void) | null = null

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  leavePage?.()
  leavePage = null
  vi.useRealTimers()
})

describe('afterCrmListReady', () => {
  it('没有页面声明要等客人表时，当场执行（其它页面行为不变）', () => {
    const run = vi.fn()
    afterCrmListReady(run)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('页面声明后先不执行，客人表一加载完就执行', () => {
    leavePage = expectCrmList()
    const run = vi.fn()
    afterCrmListReady(run)
    expect(run).not.toHaveBeenCalled()
    markCrmListReady()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('已经加载完之后再来的，当场执行', () => {
    leavePage = expectCrmList()
    markCrmListReady()
    const run = vi.fn()
    afterCrmListReady(run)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('客人表一直没回来：等满兜底时间照样执行，只执行一次', () => {
    leavePage = expectCrmList()
    const run = vi.fn()
    afterCrmListReady(run, 4000)
    vi.advanceTimersByTime(3999)
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(run).toHaveBeenCalledTimes(1)
    markCrmListReady()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('组件卸载时取消，不会再执行', () => {
    leavePage = expectCrmList()
    const run = vi.fn()
    const cancel = afterCrmListReady(run)
    cancel()
    markCrmListReady()
    vi.advanceTimersByTime(10_000)
    expect(run).not.toHaveBeenCalled()
  })

  it('离开页面后状态复位：下一个页面不受上一个页面影响', () => {
    leavePage = expectCrmList()
    markCrmListReady()
    leavePage()
    leavePage = null
    const run = vi.fn()
    afterCrmListReady(run)
    expect(run).toHaveBeenCalledTimes(1)
  })
})
