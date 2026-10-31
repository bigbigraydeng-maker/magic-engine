/**
 * `pushConversionReviewItems()` 里「授权失效、已批准的记录发不出去」那条人工任务的测试
 * （2026-09-22）。拉模式：直接查库，不依赖补发步骤有没有跑。
 */
import { describe, expect, it, vi } from 'vitest'
import { pushConversionReviewItems } from '../conversion-review-items'
import type { ManualItem } from '../manual-items'

type Row = Record<string, unknown>
const NOW = new Date('2026-09-22T18:00:00.000Z')
const CTS = 'c0000000-0000-0000-0000-000000000000'
const NAL = '4ae76381-cd45-43bd-85cd-98cfd7604007'

/**
 * 实测核实（对着 conversion-review-items.ts 源码查过）：三段查询分别是
 *   me_sale_outcomes: select → eq → is → order → limit → await
 *   me_conversion_writebacks（in_doubt）: select → eq → limit → await
 *   me_conversion_writebacks（auth）: select → eq → eq → limit → await
 *   me_conversion_writebacks（held）: select → eq → contains → eq → is → in → gte → order → limit → await
 * 假件按 (table, status) 分流。点路径、排序和 limit 按真语义，过滤在截断之前。
 */
function cell(row: Row, path: string): unknown {
  let cur: unknown = row
  for (const part of path.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as Row)[part]
  }
  return cur
}

function fakeSupabase(seed: { pending?: Row[]; doubts?: Row[]; authFailed?: Row[]; held?: Row[]; qualified?: Row[] }) {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = []
      let sortCol: string | null = null
      let sortAsc = true
      let cap: number | null = null
      const source = () => {
        if (table === 'me_sale_outcomes') return [...(seed.pending ?? []), ...(seed.qualified ?? [])]
        return [...(seed.doubts ?? []), ...(seed.authFailed ?? []), ...(seed.held ?? [])]
      }
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (c: string, v: unknown) => (filters.push((r) => cell(r, c) === v), b),
        is: (c: string, v: unknown) => (filters.push((r) => (cell(r, c) ?? null) === v), b),
        in: (c: string, values: unknown[]) => (filters.push((r) => values.includes(cell(r, c))), b),
        gte: (c: string, v: unknown) => (filters.push((r) => String(cell(r, c) ?? '') >= String(v)), b),
        contains: (c: string, v: Record<string, unknown>) => (
          filters.push((r) => {
            const cur = cell(r, c)
            if (!cur || typeof cur !== 'object') return false
            return Object.entries(v).every(([k, val]) => (cur as Row)[k] === val)
          }),
          b
        ),
        order: (c: string, opts?: { ascending?: boolean; foreignTable?: string }) => {
          sortCol = opts?.foreignTable ? `${opts.foreignTable}.${c}` : c
          sortAsc = opts?.ascending !== false
          return b
        },
        limit: (n: number) => {
          cap = n
          return b
        },
        then: (resolve: (v: { data: Row[]; error: null }) => unknown) => {
          let out = source().filter((r) => filters.every((f) => f(r)))
          if (sortCol) {
            const col = sortCol
            out = [...out].sort((a, b) => {
              const cmp = String(cell(a, col) ?? '').localeCompare(String(cell(b, col) ?? ''))
              return sortAsc ? cmp : -cmp
            })
          }
          if (cap != null) out = out.slice(0, cap)
          return resolve({ data: out, error: null })
        },
      }
      return b
    },
  }
}

function authRow(id: string, over: { client_id?: string; occurred_at?: string; review_status?: string; redacted_at?: string | null } = {}): Row {
  return {
    id: `wb-${id}`,
    outcome_id: id,
    status: 'failed',
    last_error_code: 'auth',
    me_sale_outcomes: {
      client_id: over.client_id ?? CTS,
      occurred_at: over.occurred_at ?? '2026-09-20T00:00:00.000Z',
      review_status: over.review_status ?? 'approved',
      redacted_at: over.redacted_at ?? null,
    },
  }
}

const names = new Map([
  [CTS, { name: 'CTS Tours' }],
  [NAL, { name: 'NAL' }],
])

describe('conversion_capi_token_dead 待办', () => {
  it('同一客户多条授权失败 → 合并成一条，说清几条、最早的几天后过期，href 是绝对网址', async () => {
    const items: ManualItem[] = []
    await pushConversionReviewItems(
      fakeSupabase({ authFailed: [authRow('a', { occurred_at: '2026-09-18T00:00:00.000Z' }), authRow('b')] }) as never,
      items,
      names,
      NOW,
    )
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'conversion_capi_token_dead', client_id: CTS, client_name: 'CTS Tours' })
    expect(items[0].what).toContain('2 条')
    expect(items[0].what).toContain('再过 3 天') // 9/18 → 9/25 过期，今天 9/22
    expect(items[0].how).toContain('重新连接')
    expect(items[0].href).toMatch(/^https:\/\/app\.magicengine\.com\.au\/dashboard\/conversions\?client=/)
    expect(items[0].href).toContain('status=failed')
  })

  it('不同客户各出一条', async () => {
    const items: ManualItem[] = []
    await pushConversionReviewItems(fakeSupabase({ authFailed: [authRow('a'), authRow('b', { client_id: NAL })] }) as never, items, names, NOW)
    expect(items.map((i) => i.client_id).sort()).toEqual([NAL, CTS].sort())
  })

  it('已经过了 7 天的不催（补发步骤自己会判过期）；没批准 / 已删个人信息的也不催', async () => {
    const items: ManualItem[] = []
    await pushConversionReviewItems(
      fakeSupabase({
        authFailed: [
          authRow('old', { occurred_at: '2026-09-01T00:00:00.000Z' }),
          authRow('pending', { review_status: 'pending_review' }),
          authRow('redacted', { redacted_at: '2026-09-21T00:00:00.000Z' }),
        ],
      }) as never,
      items,
      names,
      NOW,
    )
    expect(items).toHaveLength(0)
  })

  it('查询失败 → 抛错（由 manual-items.ts 的 .catch() 兜底，不在这里吞掉）', async () => {
    const broken = {
      from: (table: string) => {
        const b: Record<string, unknown> = {
          select: () => b,
          eq: () => b,
          is: () => b,
          order: () => b,
          limit: () => b,
          in: () => b,
          gte: () => b,
          contains: () => b,
          then: (resolve: (v: { data: Row[] | null; error: { message: string } | null }) => unknown) =>
            resolve(table === 'me_conversion_writebacks' ? { data: null, error: { message: '模拟故障' } } : { data: [], error: null }),
        }
        return b
      },
    }
    await expect(pushConversionReviewItems(broken as never, [], names, NOW)).rejects.toThrow('模拟故障')
  })
})

describe('名单停住的已批准成交', () => {
  const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const clientNames = new Map([[CLIENT, { name: '示例客户' }]])

  function held(
    id: string,
    over: {
      occurred_at?: string
      review_status?: string
      redacted_at?: string | null
      payload?: Record<string, unknown>
      outcome_kind?: 'purchase' | 'balance' | 'lead'
    } = {},
  ): Row {
    return {
      id: `wb-${id}`,
      outcome_id: id,
      status: 'queued',
      payload_preview: over.payload ?? { held: true },
      me_sale_outcomes: {
        client_id: CLIENT,
        outcome_kind: over.outcome_kind ?? 'purchase',
        occurred_at: over.occurred_at ?? '2026-09-20T00:00:00.000Z',
        review_status: over.review_status ?? 'approved',
        redacted_at: over.redacted_at ?? null,
      },
    }
  }

  it('按客户合成一句，链到需要你动手', async () => {
    const items: ManualItem[] = []
    await pushConversionReviewItems(
      fakeSupabase({ held: [held('a', { occurred_at: '2026-09-18T00:00:00.000Z' }), held('b')] }) as never,
      items,
      clientNames,
      NOW,
    )
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('2 笔已经批准的成交')
    expect(items[0].what).toContain('再过 3 天就过期')
    expect(items[0].how).toContain('再试一次')
    expect(items[0].href).toContain('status=held')
    expect(items[0].kind).toBe('conversion_needs_review')
  })

  it('没被名单停住、没批准、或已经过了 7 天的不催', async () => {
    const items: ManualItem[] = []
    await pushConversionReviewItems(
      fakeSupabase({
        held: [
          held('plain', { payload: { held: false } }),
          held('pending', { review_status: 'pending_review' }),
          held('old', { occurred_at: '2026-09-01T00:00:00.000Z' }),
        ],
      }) as never,
      items,
      clientNames,
      NOW,
    )
    expect(items).toHaveLength(0)
  })

  it('被名单停住的咨询不写成待处理的成交', async () => {
    const items: ManualItem[] = []
    await pushConversionReviewItems(
      fakeSupabase({
        held: [held('deal', { outcome_kind: 'purchase' }), held('ask', { outcome_kind: 'lead' }), held('tail', { outcome_kind: 'balance' })],
      }) as never,
      items,
      clientNames,
      NOW,
    )
    const deals = items.find((i) => i.what.includes('笔已经批准的成交'))
    const inquiry = items.find((i) => i.what.includes('按名单不发，不用处理'))
    expect(deals?.what).toContain('2 笔已经批准的成交')
    expect(deals?.what).not.toContain('3 笔')
    expect(inquiry?.what).toBe('按名单不发，不用处理。')
    expect(inquiry?.how).toContain('1 条已批准的咨询')
    expect(inquiry?.how).toContain('不用改名单')
  })

  it('先滤掉过期行再截 200 条，窗口里最新的成交不会被挤掉', async () => {
    const expired = Array.from({ length: 201 }, (_, i) => held(`old-${i}`, { occurred_at: '2026-09-01T00:00:00.000Z' }))
    const newer = Array.from({ length: 200 }, (_, i) =>
      held(`new-${i}`, { occurred_at: `2026-09-21T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z` }),
    )
    const oldestKept = held('edge', { occurred_at: '2026-09-16T00:00:00.000Z' })
    const items: ManualItem[] = []
    await pushConversionReviewItems(
      fakeSupabase({ held: [...expired, oldestKept, ...newer] }) as never,
      items,
      clientNames,
      NOW,
    )
    const deals = items.find((i) => i.what.includes('笔已经批准的成交'))
    expect(deals?.what).toContain('200 笔已经批准的成交')
    expect(deals?.what).toContain('再过 6 天就过期')
    expect(deals?.what).not.toContain('再过 1 天')
  })
})

describe('已报价发给广告平台没成功', () => {
  function quoted(id: string, over: Row = {}): Row {
    return {
      id,
      client_id: CTS,
      outcome_kind: 'lead',
      source_kind: 'crm_stage_manual',
      source_ref: `crm_qualified:contact:${id}`,
      review_status: 'approved',
      redacted_at: null,
      occurred_at: '2026-09-20T00:00:00.000Z',
      ...over,
    }
  }

  function sendRow(outcomeId: string, over: Row = {}): Row {
    return {
      outcome_id: outcomeId,
      event_id: outcomeId,
      status: 'failed',
      last_error_code: 'retry',
      payload_preview: null,
      ...over,
    }
  }

  it('失败或还没发送记录的已报价进今日待办，已发出和授权失效的不进', async () => {
    const items: ManualItem[] = []
    await pushConversionReviewItems(
      fakeSupabase({
        qualified: [
          quoted('failed-one'),
          quoted('missing-one'),
          quoted('sent-one'),
          quoted('auth-one'),
          quoted('held-one'),
          quoted('other', { source_ref: 'messenger:1' }),
        ],
        doubts: [
          sendRow('failed-one'),
          sendRow('sent-one', { status: 'confirmed' }),
          sendRow('auth-one', { last_error_code: 'auth' }),
          sendRow('held-one', { status: 'queued', payload_preview: { held: true } }),
        ],
      }) as never,
      items,
      names,
      NOW,
    )
    const quotes = items.filter((item) => item.what.includes('已报价发给广告平台没成功'))
    expect(quotes.map((item) => item.href)).toEqual([
      'https://app.magicengine.com.au/dashboard/conversions?client=c0000000-0000-0000-0000-000000000000&focus=failed-one',
      'https://app.magicengine.com.au/dashboard/conversions?client=c0000000-0000-0000-0000-000000000000&focus=missing-one',
    ])
    expect(quotes[0].how).toContain('再试一次')
    expect(quotes[0].what).not.toContain('回写')
    expect(quotes[0].kind).toBe('conversion_needs_review')
  })
})
