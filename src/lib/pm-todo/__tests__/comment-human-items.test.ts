import { describe, it, expect } from 'vitest'
import {
  buildCommentHumanTodos,
  pushCommentHumanItems,
  commentHumanTodoTextLooksSafe,
  WINDOW_DAYS,
  type CommentEngagementRow,
} from '../comment-human-items'
import type { ClientRow } from '../client-roster'

const NOW = new Date('2026-11-01T12:00:00Z')
const CLIENT = '11111111-1111-1111-1111-111111111111'
const active = new Set([CLIENT])

function row(over: Partial<CommentEngagementRow> = {}): CommentEngagementRow {
  return {
    client_id: CLIENT,
    category: 'question',
    comment_text: 'How much per person?',
    author_name: 'Guest User',
    reviewed_by: null,
    created_at: '2026-10-28T00:00:00Z',
    needs_human: true,
    ...over,
  }
}

function clientsMap(): Map<string, ClientRow> {
  return new Map([[CLIENT, { id: CLIENT, name: 'Demo Client', client_status: 'active' } as ClientRow]])
}

describe('buildCommentHumanTodos', () => {
  it('同一客户多条 human 只出一条待办', () => {
    const items = buildCommentHumanTodos(
      [row(), row({ comment_text: 'I want a refund' })],
      active,
    )
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('comment_needs_human_reply')
    expect(items[0].what).toContain('2 条')
  })

  it('reviewed_by 有值的不算', () => {
    expect(buildCommentHumanTodos([row({ reviewed_by: 'fde@example.com' })], active)).toEqual([])
  })

  it('needs_human=true 且关键词 auto_ok 仍进待办，计为待你判断', () => {
    const items = buildCommentHumanTodos(
      [row({ comment_text: '你好，这个行程包含什么？' })],
      active,
    )
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('待你判断')
  })

  it('needs_human=false 的行跳过', () => {
    expect(buildCommentHumanTodos([row({ needs_human: false })], active)).toEqual([])
  })

  it('href 是绝对网址', () => {
    const href = buildCommentHumanTodos([row()], active)[0]?.href ?? ''
    expect(href).toMatch(/^https:\/\/app\.magicengine\.com\.au\//)
    expect(href).toContain('settings?tab=content')
  })

  it('文字里没有评论原文', () => {
    const longComment = 'This is a very specific comment snippet about pricing 9999'
    const items = buildCommentHumanTodos([row({ comment_text: longComment })], active)
    const t = items[0]
    expect(t.what).not.toContain(longComment)
    expect(t.how).not.toContain(longComment)
    expect(t.what).toContain(String(WINDOW_DAYS))
  })

  it('问价 how 提到引导私信、公开不报价', () => {
    const how = buildCommentHumanTodos([row()], active)[0]?.how ?? ''
    expect(how).toContain('私信')
    expect(how).toContain('不要报具体价格')
  })
})

describe('commentHumanTodoTextLooksSafe', () => {
  it('模板文案默认通过', () => {
    const items = buildCommentHumanTodos([row()], active)
    expect(commentHumanTodoTextLooksSafe(items[0], [row()])).toBe(true)
  })
})

describe('pushCommentHumanItems', () => {
  it('读失败时报读不到，不是 0 条', async () => {
    const items: import('../manual-items').ManualItem[] = []
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              gte: () => ({
                order: () => ({
                  order: () => ({
                    range: () => Promise.resolve({ data: null, error: { message: 'permission denied' } }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    }
    await pushCommentHumanItems(supabase as never, items, clientsMap(), NOW)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('comment_human_check_failed')
    expect(items[0].what).toContain('读不出来')
  })

  it('超过 14 天的行不会进 fetch 条件（gte 截断）', async () => {
    const gteCalls: string[] = []
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              gte: (_col: string, val: string) => {
                gteCalls.push(val)
                return {
                  order: () => ({
                    order: () => ({
                      range: () => Promise.resolve({ data: [], error: null }),
                    }),
                  }),
                }
              },
            }),
          }),
        }),
      }),
    }
    await pushCommentHumanItems(supabase as never, [], clientsMap(), NOW)
    expect(gteCalls).toHaveLength(1)
    const sinceMs = Date.parse(gteCalls[0]!)
    const expectedMs = NOW.getTime() - WINDOW_DAYS * 86_400_000
    expect(Math.abs(sinceMs - expectedMs)).toBeLessThan(2000)
  })

  it('读成功时写入汇总待办并带上客户名', async () => {
    const items: import('../manual-items').ManualItem[] = []
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              gte: () => ({
                order: () => ({
                  order: () => ({
                    range: () => Promise.resolve({ data: [row()], error: null }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    }
    await pushCommentHumanItems(supabase as never, items, clientsMap(), NOW)
    expect(items).toHaveLength(1)
    expect(items[0].client_name).toBe('Demo Client')
  })
})
