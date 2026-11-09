import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  useOpenContactFromNudge,
  type OpenContactArgs,
} from '../useOpenContactFromNudge'

const NOT_ON_PAGE_MESSAGE = '这个人不在当前这一页，请用上面的搜索框找他。'
const NOT_IN_LIST_MESSAGE = '他不在这份名单里了 —— 用上面的搜索框找找看'

interface Harness {
  contactIds: string[]
  loading: boolean
  sectionsLoading: boolean
  debouncedQuery: string
  setQuery: ReturnType<typeof vi.fn>
  openDrawer: ReturnType<typeof vi.fn>
  notify: ReturnType<typeof vi.fn>
}

function makeArgs(over: Partial<Harness> = {}): Harness {
  return {
    contactIds: [],
    loading: false,
    sectionsLoading: false,
    debouncedQuery: '',
    setQuery: vi.fn(),
    openDrawer: vi.fn(),
    notify: vi.fn(),
    ...over,
  }
}

function toArgs(h: Harness): OpenContactArgs {
  return {
    contactIds: h.contactIds,
    loading: h.loading,
    sectionsLoading: h.sectionsLoading,
    debouncedQuery: h.debouncedQuery,
    setQuery: h.setQuery,
    openDrawer: h.openDrawer,
    notify: h.notify,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('useOpenContactFromNudge', () => {
  it('opens the drawer immediately when the contact is on the page', () => {
    const args = makeArgs({ contactIds: ['c1'] })
    const { result } = renderHook(
      (props: OpenContactArgs) => useOpenContactFromNudge(props),
      { initialProps: toArgs(args) },
    )

    act(() => {
      result.current('c1', '客人一')
    })

    expect(args.openDrawer).toHaveBeenCalledTimes(1)
    expect(args.openDrawer).toHaveBeenCalledWith('c1')
    expect(args.setQuery).not.toHaveBeenCalled()
    expect(args.notify).not.toHaveBeenCalled()
  })

  it('searches by name, waits for a loading cycle, then opens the drawer', () => {
    const args = makeArgs({ contactIds: [] })
    const { result, rerender } = renderHook(
      (props: OpenContactArgs) => useOpenContactFromNudge(props),
      { initialProps: toArgs(args) },
    )

    act(() => {
      result.current('c9', '客人九')
    })

    expect(args.setQuery).toHaveBeenCalledTimes(1)
    expect(args.setQuery).toHaveBeenCalledWith('客人九')
    expect(args.openDrawer).not.toHaveBeenCalled()

    // debouncedQuery now matches, but no loading cycle has started yet.
    args.debouncedQuery = '客人九'
    rerender(toArgs(args))
    expect(args.openDrawer).not.toHaveBeenCalled()
    expect(args.notify).not.toHaveBeenCalled()

    // A loading cycle begins.
    args.loading = true
    rerender(toArgs(args))
    expect(args.openDrawer).not.toHaveBeenCalled()

    // Loading finishes and the contact is now in the list.
    args.loading = false
    args.contactIds = ['c9']
    rerender(toArgs(args))

    expect(args.openDrawer).toHaveBeenCalledTimes(1)
    expect(args.openDrawer).toHaveBeenCalledWith('c9')
    expect(args.notify).not.toHaveBeenCalled()
  })

  it('notifies when the contact is still missing after the loading cycle', () => {
    const args = makeArgs({ contactIds: [] })
    const { result, rerender } = renderHook(
      (props: OpenContactArgs) => useOpenContactFromNudge(props),
      { initialProps: toArgs(args) },
    )

    act(() => {
      result.current('c9', '客人九')
    })

    args.debouncedQuery = '客人九'
    rerender(toArgs(args))

    args.loading = true
    rerender(toArgs(args))

    args.loading = false
    args.contactIds = []
    rerender(toArgs(args))

    expect(args.notify).toHaveBeenCalledTimes(1)
    expect(args.notify).toHaveBeenCalledWith(NOT_IN_LIST_MESSAGE)
    expect(args.openDrawer).not.toHaveBeenCalled()
  })

  it('notifies when the name is null or blank and does not search', () => {
    const args = makeArgs({ contactIds: [] })
    const { result } = renderHook(
      (props: OpenContactArgs) => useOpenContactFromNudge(props),
      { initialProps: toArgs(args) },
    )

    act(() => {
      result.current('c9', null)
    })
    expect(args.notify).toHaveBeenCalledWith(NOT_ON_PAGE_MESSAGE)
    expect(args.setQuery).not.toHaveBeenCalled()

    args.notify.mockClear()
    act(() => {
      result.current('c9', '   ')
    })
    expect(args.notify).toHaveBeenCalledWith(NOT_ON_PAGE_MESSAGE)
    expect(args.setQuery).not.toHaveBeenCalled()
  })

  it('notifies immediately when the query already equals the name', () => {
    const args = makeArgs({ contactIds: [], debouncedQuery: '客人九' })
    const { result } = renderHook(
      (props: OpenContactArgs) => useOpenContactFromNudge(props),
      { initialProps: toArgs(args) },
    )

    act(() => {
      result.current('c9', '客人九')
    })

    expect(args.notify).toHaveBeenCalledTimes(1)
    expect(args.notify).toHaveBeenCalledWith(NOT_IN_LIST_MESSAGE)
    expect(args.setQuery).not.toHaveBeenCalled()
    expect(args.openDrawer).not.toHaveBeenCalled()
  })

  it('notifies once via the safety timer when no loading cycle happens', () => {
    vi.useFakeTimers()
    const args = makeArgs({ contactIds: [] })
    const { result } = renderHook(
      (props: OpenContactArgs) => useOpenContactFromNudge(props),
      { initialProps: toArgs(args) },
    )

    act(() => {
      result.current('c9', '客人九')
    })

    expect(args.setQuery).toHaveBeenCalledWith('客人九')
    expect(args.notify).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(8000)
    })

    expect(args.notify).toHaveBeenCalledTimes(1)
    expect(args.notify).toHaveBeenCalledWith(NOT_IN_LIST_MESSAGE)
    expect(args.openDrawer).not.toHaveBeenCalled()
  })
})
