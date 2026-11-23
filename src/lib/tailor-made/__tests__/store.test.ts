/**
 * saveItinerary() 的乐观并发条件写。
 *
 * 背景（#1234，PR #1226 Codex round-2 遗留问题）：import/extract 后台任务回存
 * 草稿之前是「先 getItinerary() 读一次 updated_at 判断，再 saveItinerary() 写一次」
 * ——两条独立查询之间有空隙，顾问在这个空隙里手动存了新版本，判断已经过去了，
 * 写入照样落地，版本检查保护不到它自己守着的这次写入。
 *
 * 现在改成 saveItinerary() 内部一条 UPDATE 带 `.eq('updated_at', expectedUpdatedAt)`
 * 条件，成功落地才算数，命中 0 行（不管是因为版本变了还是行程被删了）都当
 * 「跳过，不是失败」处理，返回 null 而不是抛错。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

import { supabaseAdmin } from '@/lib/supabase'
import { saveItinerary } from '../store'
import { createBlankItinerary } from '../types'

const CLIENT = 'client-cts'
const ITINERARY = 'itin-1'

const payload = createBlankItinerary('CTS-2026-0001')

const RECORD_ROW = {
  id: ITINERARY,
  client_id: CLIENT,
  quote_ref: 'CTS-2026-0001',
  end_client_name: '',
  trip_title: '',
  status: 'draft',
  payload,
  consultant_name: null,
  consultant_email: null,
  sent_at: null,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-28T10:00:00.000Z',
}

/** 装一个能记录 eq() 调用序列、最后在 select() 上落地结果的假 update 链 */
function mockUpdateChain(result: { data: unknown[] | null; error: { message: string } | null }) {
  const eqCalls: Array<[string, unknown]> = []
  let capturedPatch: Record<string, unknown> | undefined
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    if (table !== 'tailor_made_itineraries') throw new Error(`unexpected table ${table}`)
    return {
      update: (patch: Record<string, unknown>) => {
        capturedPatch = patch
        const chain = {
          eq: (col: string, val: unknown) => {
            eqCalls.push([col, val])
            return chain
          },
          select: () => Promise.resolve(result),
        }
        return chain
      },
    }
  })
  return { eqCalls, getPatch: () => capturedPatch }
}

describe('saveItinerary — 乐观并发条件写', () => {
  beforeEach(() => vi.clearAllMocks())

  it('expectedUpdatedAt 跟库里一致时，一条 UPDATE 带上 updated_at 条件并落库', async () => {
    const { eqCalls } = mockUpdateChain({ data: [RECORD_ROW], error: null })

    const result = await saveItinerary(CLIENT, ITINERARY, payload, undefined, {
      expectedUpdatedAt: '2026-08-28T10:00:00.000Z',
    })

    expect(result).toEqual(RECORD_ROW)
    expect(eqCalls).toEqual([
      ['client_id', CLIENT],
      ['id', ITINERARY],
      ['updated_at', '2026-08-28T10:00:00.000Z'],
    ])
  })

  it('expectedUpdatedAt 跟库里不一致（UPDATE 影响 0 行）时返回 null，不抛错', async () => {
    // 真实数据库里 WHERE ... AND updated_at = $stale 不会匹配到任何行，
    // select() 拿到空数组——这里模拟的就是这个结果，不是模拟异常。
    mockUpdateChain({ data: [], error: null })

    const result = await saveItinerary(CLIENT, ITINERARY, payload, undefined, {
      expectedUpdatedAt: '2026-08-28T09:00:00.000Z', // 顾问在等待期间已经存过新版本，这是过期的基线
    })

    expect(result).toBeNull()
  })

  it('行程已被删除时同样返回 null（不需要单独查一次是否存在）', async () => {
    // 行不存在时 WHERE client_id/id/updated_at 三个条件天然都不匹配，
    // 跟"版本变了"走的是同一条路径——不需要 import/extract 路由里
    // 再单独 getItinerary() 判断"草稿被删了"。
    mockUpdateChain({ data: [], error: null })

    const result = await saveItinerary(CLIENT, 'deleted-itinerary', payload, undefined, {
      expectedUpdatedAt: '2026-08-28T10:00:00.000Z',
    })

    expect(result).toBeNull()
  })

  it('不传 opts 时行为不变：无条件更新，只带 client_id / id 两个 eq', async () => {
    const { eqCalls, getPatch } = mockUpdateChain({ data: [RECORD_ROW], error: null })

    const result = await saveItinerary(CLIENT, ITINERARY, payload)

    expect(result).toEqual(RECORD_ROW)
    expect(eqCalls).toEqual([
      ['client_id', CLIENT],
      ['id', ITINERARY],
    ])
    expect(getPatch()).not.toHaveProperty('updated_at')
  })

  it('不传 opts 且找不到对应行程单时照常抛错（原来 .single() 在 0 行时也是这样）', async () => {
    mockUpdateChain({ data: [], error: null })

    await expect(saveItinerary(CLIENT, 'not-found', payload)).rejects.toThrow(/保存行程单失败/)
  })

  it('查询本身报错时抛出，不管有没有传 expectedUpdatedAt', async () => {
    mockUpdateChain({ data: null, error: { message: 'db down' } })

    await expect(
      saveItinerary(CLIENT, ITINERARY, payload, undefined, { expectedUpdatedAt: 'x' })
    ).rejects.toThrow(/保存行程单失败/)
  })

  it('status=sent 时 patch 带上 sent_at，条件写不影响这部分既有逻辑', async () => {
    const { getPatch } = mockUpdateChain({ data: [RECORD_ROW], error: null })

    await saveItinerary(CLIENT, ITINERARY, payload, 'sent', { expectedUpdatedAt: '2026-08-28T10:00:00.000Z' })

    const patch = getPatch()
    expect(patch?.status).toBe('sent')
    expect(patch?.sent_at).toEqual(expect.any(String))
  })
})
