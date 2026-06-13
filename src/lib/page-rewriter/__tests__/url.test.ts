import { describe, expect, it } from 'vitest'
import { pageRewriterUrlForExecutionItem } from '../url'

describe('pageRewriterUrlForExecutionItem', () => {
  const CLIENT  = '11111111-1111-1111-1111-111111111111'
  const ITEM    = '22222222-2222-2222-2222-222222222222'

  it('builds the canonical href with kanban_item_id only when no targetUrl', () => {
    const href = pageRewriterUrlForExecutionItem(CLIENT, ITEM)
    expect(href).toBe(`/dashboard/clients/${CLIENT}/page-rewriter?kanban_item_id=${ITEM}`)
  })

  it('appends url=… when targetUrl is provided', () => {
    const href = pageRewriterUrlForExecutionItem(CLIENT, ITEM, 'https://oztop.com.au/tile-sizes-explained/')
    expect(href).toContain('kanban_item_id=22222222-2222-2222-2222-222222222222')
    expect(href).toContain('url=https%3A%2F%2Foztop.com.au%2Ftile-sizes-explained%2F')
  })

  it.each([null, undefined, '', '   '])('treats %p as no targetUrl', (v) => {
    const href = pageRewriterUrlForExecutionItem(CLIENT, ITEM, v as string | null | undefined)
    expect(href).not.toContain('url=')
  })

  it('encodes a client id containing slashes / spaces (defensive)', () => {
    const href = pageRewriterUrlForExecutionItem('a/b c', ITEM)
    expect(href).toContain('/dashboard/clients/a%2Fb%20c/page-rewriter?')
  })

  it('does NOT encode the executionItemId twice (URLSearchParams handles it)', () => {
    const href = pageRewriterUrlForExecutionItem(CLIENT, 'id with space')
    // URLSearchParams will use + for spaces, which is valid in query strings.
    expect(href).toContain('kanban_item_id=id+with+space')
  })

  it('trims leading/trailing whitespace from targetUrl', () => {
    const href = pageRewriterUrlForExecutionItem(CLIENT, ITEM, '  https://x.com/a/  ')
    expect(href).toContain('url=https%3A%2F%2Fx.com%2Fa%2F')
  })
})
