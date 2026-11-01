/**
 * POST /crm/touchpoints 的「约回电」快捷项：从请求体一路到写进触点的 metadata。
 *
 * 用真的路由 + 真的 recordManualTouchpoint，只替掉数据库和 AI 解析，
 * 这样「结构化时间赢过 AI」「原话原样保存」这两条是真的被端到端钉住，
 * 不是各测各的零件。
 *
 * 时钟：新西兰周日 2026-11-01 14:00（UTC+13）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  from: vi.fn(),
  parseNote: vi.fn(),
  upserts: [] as Array<Record<string, unknown>>,
  contactPatches: [] as Array<Record<string, unknown>>,
  country: null as string | null,
  inserted: true,
}))

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: mocks.access }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))
vi.mock('@/lib/crm/note-parser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/crm/note-parser')>()
  return { ...actual, parseNote: mocks.parseNote }
})

import { NextRequest } from 'next/server'
import { POST } from '../route'

const NOW = new Date('2026-11-01T01:00:00.000Z')
const AI_CALLBACK = '2026-11-20T00:00:00.000Z'

function parse(over: Record<string, unknown> = {}) {
  return {
    outcome: 'spoke',
    do_not_contact: false,
    travel_window: null,
    tour_interest: null,
    competitor: null,
    callback_at: AI_CALLBACK,
    mentioned_next_step: true,
    summary: 'AI 整理的摘要',
    ...over,
  }
}

function call(body: Record<string, unknown>) {
  const req = new NextRequest('http://localhost/api/clients/cts/crm/touchpoints', {
    method: 'POST',
    body: JSON.stringify({ contactId: 'c1', clientRef: 'ref-1', note: '客人在忙，约个时间再聊', ...body }),
  })
  return POST(req, { params: { id: 'cts' } })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  mocks.upserts.length = 0
  mocks.contactPatches.length = 0
  mocks.country = 'NZ'
  mocks.inserted = true
  mocks.access.mockResolvedValue({ ok: true, user: { email: 'info@ctstours.co.nz' } })
  mocks.parseNote.mockResolvedValue(parse())
  mocks.from.mockImplementation((table: string) => {
    if (table === 'contacts') {
      return {
        select: () => ({
          eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'c1', last_seen_at: null }, error: null }) }) }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: () => ({
            eq: async () => {
              mocks.contactPatches.push(patch)
              return { error: null }
            },
          }),
        }),
      }
    }
    if (table === 'clients') {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { brand_aliases: null, country: mocks.country }, error: null }) }),
        }),
      }
    }
    if (table === 'contact_touchpoints') {
      return {
        upsert: (row: Record<string, unknown>) => {
          mocks.upserts.push(row)
          return { select: () => ({ maybeSingle: async () => ({ data: mocks.inserted ? { id: 'tp-1' } : null, error: null }) }) }
        },
      }
    }
    throw new Error(`没预料到的表：${table}`)
  })
})

afterEach(() => {
  vi.useRealTimers()
})

const meta = () => mocks.upserts[0].metadata as Record<string, unknown>

describe('快捷项选了时间', () => {
  it('明天上午 10 点：写成 callback_set + 客户时区的真实时刻，赢过 AI 读出来的时间', async () => {
    const res = await call({ callbackPreset: 'tomorrow_am' })
    expect(res.status).toBe(200)
    expect(meta().callback_at).toBe('2026-11-01T21:00:00.000Z')
    expect(meta().outcome).toBe('callback_set')
    expect(meta().callback_at).not.toBe(AI_CALLBACK)
  })

  it('员工写的原话一个字不动（raw），不会被换成按钮的文案', async () => {
    await call({ callbackPreset: 'tomorrow_pm', note: '  客人在开会，说下午再聊  ' })
    expect(mocks.upserts[0].raw).toBe('客人在开会，说下午再聊')
    expect(meta().callback_at).toBe('2026-11-02T01:00:00.000Z')
  })

  it('保存后给销售的确认：「已约 …… 回电」，并回传实际存下的时间', async () => {
    const res = await call({ callbackPreset: 'tomorrow_am' })
    const json = (await res.json()) as { callbackBooked: string; parsed: { callback_at: string } }
    expect(json.callbackBooked).toContain('已约')
    expect(json.callbackBooked).toContain('11月2日')
    expect(json.callbackBooked).toContain('10:00')
    expect(json.parsed.callback_at).toBe('2026-11-01T21:00:00.000Z')
  })

  it('自选时间（不带时区）按客户所在地算；澳洲客户按悉尼', async () => {
    await call({ callbackAt: '2026-11-03T14:00' })
    expect(meta().callback_at).toBe('2026-11-03T01:00:00.000Z')

    mocks.upserts.length = 0
    mocks.country = 'AU'
    await call({ callbackAt: '2026-11-03T14:00', clientRef: 'ref-2' })
    expect(meta().callback_at).toBe('2026-11-03T03:00:00.000Z')
  })
})

describe('服务端校验：挡在写库之前', () => {
  it.each([
    ['过去的时间', { callbackAt: '2026-10-31T10:00' }],
    ['超过 60 天', { callbackAt: '2027-02-01T10:00' }],
    ['读不懂的格式', { callbackAt: '明天下午' }],
    ['快捷项名字不认识', { callbackPreset: 'next_year' }],
    ['快捷项和自选时间同时给', { callbackPreset: 'tomorrow_am', callbackAt: '2026-11-03T14:00' }],
  ])('%s → 400，什么都没写', async (_name, body) => {
    const res = await call(body)
    expect(res.status).toBe(400)
    expect(mocks.upserts).toHaveLength(0)
    expect(mocks.contactPatches).toHaveLength(0)
  })

  it('一键结果（如「没打通」）不能同时约回电 → 400', async () => {
    const res = await call({ outcome: 'no_answer', callbackPreset: 'tomorrow_am' })
    expect(res.status).toBe(400)
    expect(mocks.upserts).toHaveLength(0)
  })
})

describe('时区不明 / 幂等重试：不假装排上了', () => {
  it.each([[null], [''], ['US']])('客户国家是 %j：选了回电 → 400 讲清原因，什么都没写', async (country) => {
    mocks.country = country
    const res = await call({ callbackPreset: 'tomorrow_am' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toContain('所在国家')
    expect(mocks.upserts).toHaveLength(0)
  })

  it('国家没填但没选回电：照旧能记（解析原话仍兜底新西兰）', async () => {
    mocks.country = null
    const res = await call({})
    expect(res.status).toBe(200)
  })

  it('同一个记录框重试（命中之前那一笔，created=false）：不说「已约」', async () => {
    mocks.inserted = false
    const res = await call({ callbackPreset: 'tomorrow_am' })
    const json = (await res.json()) as { created: boolean; callbackBooked: string | null }
    expect(json.created).toBe(false)
    expect(json.callbackBooked).toBeNull()
  })
})

describe('不动旧行为', () => {
  it('没选回电：照旧用 AI 读出来的时间，也不回确认话术', async () => {
    const res = await call({})
    expect(meta().callback_at).toBe(AI_CALLBACK)
    expect(meta().outcome).toBe('spoke')
    const json = (await res.json()) as { callbackBooked: string | null }
    expect(json.callbackBooked).toBeNull()
  })

  it('原话是「没接」：保留没接的结论，只补回电时间', async () => {
    mocks.parseNote.mockResolvedValue(parse({ outcome: 'no_answer', callback_at: null }))
    await call({ callbackPreset: 'tomorrow_am', note: '打了没人接' })
    expect(meta().outcome).toBe('no_answer')
    expect(meta().callback_at).toBe('2026-11-01T21:00:00.000Z')
  })

  it('原话读出「别再联系」：合规优先，不因为点了时间就排进回电名单', async () => {
    mocks.parseNote.mockResolvedValue(
      parse({ outcome: 'do_not_contact', do_not_contact: true, callback_at: null }),
    )
    const res = await call({ callbackPreset: 'tomorrow_am', note: '客户说别再打了' })
    const json = (await res.json()) as { callbackBooked: string | null }
    expect(json.callbackBooked).toBeNull() // 没排上就绝不能说「已约」
    expect(meta().outcome).toBe('do_not_contact')
    expect(meta().callback_at).toBeNull()
    expect(mocks.contactPatches[0]).toMatchObject({ do_not_contact: true })
  })
})
