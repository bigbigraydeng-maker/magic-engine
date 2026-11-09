/**
 * `classifyConversation` —— 售前留资 vs 售后。
 *
 * 关键词样本取材自 issue #1576 验证要求里点名的五个真实场景短语（booking /
 * 我订的 / 我已付 / receipt / 我下单了），另配五条常见的售前留资开场白。
 * 边界测试钉住 30 天这个整数分界：卡在整 30 天不算售后，30 天零 1 秒才算
 * ——这条分界线本身就是 issue 明确要求的验证点，不是随手加的。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { classifyConversation, TOURISM_POST_SALE_POLICY } from '../classify'
import { supabaseAdmin } from '@/lib/supabase'

const mockFrom = vi.mocked(supabaseAdmin.from)

interface Row {
  body: string | null
  sent_at: string
}

/** 旅游行业判据里的关键词清单，直接复用 `TOURISM_POST_SALE_POLICY`，不再自己维护一份副本。 */
const KEYWORDS = TOURISM_POST_SALE_POLICY.postSaleKeywords

/**
 * 关键词现在整体加引号转义（`body.ilike."%kw%"`），引号内可能含原样的逗号 /
 * 括号，不能再直接 `.split(',')` —— 按是否在引号内手动切分子句。
 */
function splitOrClauses(filterExpr: string): string[] {
  const clauses: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < filterExpr.length; i++) {
    const ch = filterExpr[i]
    if (ch === '\\' && inQuotes) {
      current += ch + (filterExpr[i + 1] ?? '')
      i += 1
      continue
    }
    if (ch === '"') {
      inQuotes = !inQuotes
      current += ch
      continue
    }
    if (ch === ',' && !inQuotes) {
      clauses.push(current)
      current = ''
      continue
    }
    current += ch
  }
  if (current) clauses.push(current)
  return clauses
}

/** 反转实现里的两层转义（ilike 通配符层 + PostgREST 引号层），还原成原始关键词。 */
function unescapeIlikeValue(clause: string): string | undefined {
  const match = clause.match(/^body\.ilike\."%([\s\S]*)%"$/)
  if (!match) return undefined
  // PostgREST 引号解析和 ilike 默认转义字符都是「反斜杠吃掉下一个字符」，两层各还原一次。
  return match[1].replace(/\\(.)/g, '$1').replace(/\\(.)/g, '$1')
}

/** 从实现拼出的 `.or()` 过滤表达式里还原关键词列表。 */
function keywordsFromOrFilter(filterExpr: string): string[] {
  return splitOrClauses(filterExpr)
    .map(unescapeIlikeValue)
    .filter((kw): kw is string => kw !== undefined)
}

function containsAnyKeyword(body: string | null, keywords: string[]): boolean {
  if (!body) return false
  const lower = body.toLowerCase()
  return keywords.some((kw) => lower.includes(kw.toLowerCase()))
}

/**
 * 拿一组消息行（不要求预先排序）喂给 mock 的 supabase 链式调用，模拟实现
 * 现在会发出的三条独立查询：关键词存在性查询（`.or()` + `limit(1)`，直接
 * `await` 链本身）、首条 / 末条消息时间查询（`.order() + .limit(1).maybeSingle()`）。
 * 关键词从实际传进 `.or()` 的过滤表达式里还原，而不是写死一份 tourism 关键词 ——
 * 这样测试才能验证「调用方传什么 policy，查询就按什么 policy 过滤」。
 */
function stubMessages(rows: Row[]) {
  mockFrom.mockImplementation((table: string) => {
    if (table !== 'conversation_messages') throw new Error(`fake supabase: 表 '${table}' 没建模`)

    let orFilterKeywords: string[] | null = null
    let ascending = true
    let limitN: number | null = null

    const sortedAsc = [...rows].sort(
      (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
    )
    const sortedDesc = [...sortedAsc].reverse()

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      or: (filterExpr: string) => {
        orFilterKeywords = keywordsFromOrFilter(filterExpr)
        return chain
      },
      order: (_col: string, opts?: { ascending?: boolean }) => {
        ascending = opts?.ascending ?? true
        return chain
      },
      limit: (n: number) => {
        limitN = n
        return chain
      },
      maybeSingle: async () => {
        const edge = ascending ? sortedAsc[0] : sortedAsc[sortedAsc.length - 1]
        return { data: edge ?? null, error: null }
      },
      // `fetchLastTwoMessages`（issue #1773）用 `.order(desc).limit(2)` 后直接
      // 走 `.then()`，不经过 `.maybeSingle()` ——原来这条路径只服务
      // `hasPostSaleKeyword` 的 `.or()` 过滤，现在也要按 `ascending`/`limitN`
      // 正确排序+截断，不能沿用"没过滤就整表原样返回"的旧行为。
      then: (resolve: (v: { data: Row[] | null; error: null }) => unknown) => {
        if (orFilterKeywords === null) {
          const sorted = ascending ? sortedAsc : sortedDesc
          const limited = limitN !== null ? sorted.slice(0, limitN) : sorted
          return Promise.resolve({ data: limited, error: null }).then(resolve)
        }
        const matched = rows.filter((r) => containsAnyKeyword(r.body, orFilterKeywords as string[])).slice(0, 1)
        return Promise.resolve({ data: matched, error: null }).then(resolve)
      },
    }
    return chain as never
  })
}

const CONVO = 'convo-1'
const BASE = new Date('2026-01-01T00:00:00.000Z')

function iso(offsetMs: number): string {
  return new Date(BASE.getTime() + offsetMs).toISOString()
}

describe('classifyConversation', () => {
  beforeEach(() => {
    mockFrom.mockReset()
  })

  describe('售后关键词命中 → post_sale', () => {
    const cases: Array<{ label: string; body: string }> = [
      { label: 'booking（英文询问已下的订单）', body: 'Hi, I have a question about my booking for the Auckland tour' },
      { label: '我订的（中文，问已订行程细节）', body: '请问我订的那个团几点集合？' },
      { label: '我已付（中文，确认付款）', body: '我已付了定金，什么时候能收到确认单' },
      { label: 'receipt（英文，要收据）', body: 'Could you please send me the receipt for my payment?' },
      { label: '我下单了（中文，确认已下单）', body: '我下单了，但还没收到邮件通知' },
    ]

    for (const { label, body } of cases) {
      it(label, async () => {
        stubMessages([{ body, sent_at: iso(0) }])
        await expect(classifyConversation(CONVO, TOURISM_POST_SALE_POLICY)).resolves.toBe('post_sale')
      })
    }

    it('关键词大小写不敏感（BOOKING 全大写也要认）', async () => {
      stubMessages([{ body: 'Question about my BOOKING reference', sent_at: iso(0) }])
      await expect(classifyConversation(CONVO, TOURISM_POST_SALE_POLICY)).resolves.toBe('post_sale')
    })
  })

  describe('售前留资场景 → lead_intake', () => {
    const cases: Array<{ label: string; body: string }> = [
      { label: '英文询价（还没下单）', body: 'Hi, how much is the 10-day South Island tour?' },
      { label: '中文询价', body: '你好，请问新西兰6日游多少钱一个人？' },
      { label: '问团期', body: 'Do you have any tours available in December?' },
      { label: '留联系方式', body: 'My name is Jordan, phone 021 555 0134, please call me back' },
      { label: '泛泛咨询', body: '想了解一下你们的旅游团，有哪些行程可以选' },
    ]

    for (const { label, body } of cases) {
      it(label, async () => {
        stubMessages([{ body, sent_at: iso(0) }])
        await expect(classifyConversation(CONVO, TOURISM_POST_SALE_POLICY)).resolves.toBe('lead_intake')
      })
    }
  })

  describe('对话跨度边界（issue 要求的两个边界值，issue #1773 修复后：跨度长仍要求最新消息不是沉寂后才重开）', () => {
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

    it('恰好 30 天 → 不算 post_sale（严格大于才算）', async () => {
      stubMessages([
        { body: '你好，请问有没有团期', sent_at: iso(0) },
        { body: '好的，谢谢', sent_at: iso(THIRTY_DAYS_MS) },
      ])
      await expect(classifyConversation(CONVO, TOURISM_POST_SALE_POLICY)).resolves.toBe('lead_intake')
    })

    it('跨度 30 天零 1 秒 + 对话仍在连续进行（最新一条消息紧跟前一条）→ post_sale', async () => {
      stubMessages([
        { body: '你好，请问有没有团期', sent_at: iso(0) },
        { body: '好的，麻烦帮我查一下集合地点', sent_at: iso(THIRTY_DAYS_MS) },
        { body: '好的，谢谢', sent_at: iso(THIRTY_DAYS_MS + 1000) },
      ])
      await expect(classifyConversation(CONVO, TOURISM_POST_SALE_POLICY)).resolves.toBe('post_sale')
    })

    it(
      '🔴 issue #1773 真实事故复现：只有 2 条消息、跨度远超 30 天，但最新这条就是紧跟着 ' +
      '沉寂期之后重新联系——不该只凭"关系存在了很久"判 post_sale',
      async () => {
        const SIXTY_TWO_DAYS_MS = 62 * 24 * 60 * 60 * 1000
        stubMessages([
          { body: '你好，请问有没有团期', sent_at: iso(0) },
          { body: '好的，谢谢', sent_at: iso(SIXTY_TWO_DAYS_MS) },
        ])
        await expect(classifyConversation(CONVO, TOURISM_POST_SALE_POLICY)).resolves.toBe('lead_intake')
      },
    )

    it(
      'issue #1773 真实生产案例复现①："一个人去多少钱" —— 7 月留资、9 月沉寂两月后重新问价，' +
      '不该被当年 7 月的旧联系记录拖累判成 post_sale',
      async () => {
        stubMessages([
          { body: 'Which tour interests you most?: Tale of Two Cities', sent_at: iso(0) },
          { body: 'I would like a short tour but must include the warriors', sent_at: iso(5 * 60_000) },
          {
            // 生产原文实测跨度是 61 天（2026-07-10 → 2026-09-09），不是凑整的 62——
            // 精确复现，不是编一个"差不多"的相似案例。
            body: 'I’m interested but I travel alone how much is it for one person?',
            sent_at: iso(61 * 24 * 60 * 60 * 1000),
          },
        ])
        await expect(classifyConversation(CONVO, TOURISM_POST_SALE_POLICY)).resolves.toBe('lead_intake')
      },
    )

    it(
      'issue #1773 真实生产案例复现②："能不能发我行程单" —— 沉寂两月后重新联系问行程，' +
      '不该判成 post_sale',
      async () => {
        stubMessages([
          { body: 'Which tour interests you most?: Still deciding — show me all 4', sent_at: iso(0) },
          // 生产原文实测跨度恰好是 62 天（2026-07-03 → 2026-09-03）。
          { body: 'Can you send me the itinerary?', sent_at: iso(62 * 24 * 60 * 60 * 1000) },
        ])
        await expect(classifyConversation(CONVO, TOURISM_POST_SALE_POLICY)).resolves.toBe('lead_intake')
      },
    )
  })

  it('没有消息（比如 conversationId 传错）→ 保守判 lead_intake', async () => {
    stubMessages([])
    await expect(classifyConversation(CONVO, TOURISM_POST_SALE_POLICY)).resolves.toBe('lead_intake')
  })

  describe('判据必须由调用方显式传入（Codex 复审 P1）', () => {
    it('地产客户传自己的 policy 时，"booking" 不再误判成售后', async () => {
      stubMessages([
        {
          body: "I'd like to make a booking for an appraisal/consultation",
          sent_at: iso(0),
        },
      ])
      const realEstatePolicy = {
        postSaleKeywords: ['已签约', '已付定金'],
        postSaleSpanMs: 30 * 24 * 60 * 60 * 1000,
      }
      await expect(classifyConversation(CONVO, realEstatePolicy)).resolves.toBe('lead_intake')
    })
  })

  describe('policy 关键词含 PostgREST / ilike 特殊字符（Codex 复审 P2）', () => {
    it('关键词含逗号、括号、双引号仍能正确拼过滤表达式并命中', async () => {
      const body = '好的，我已确认(订单号 A1"B)，谢谢'
      stubMessages([{ body, sent_at: iso(0) }])
      const policy = {
        postSaleKeywords: ['已确认(订单号 A1"B)'],
        postSaleSpanMs: 30 * 24 * 60 * 60 * 1000,
      }
      await expect(classifyConversation(CONVO, policy)).resolves.toBe('post_sale')
    })

    it('关键词含 % / _ 只当字面量匹配，不当通配符误判', async () => {
      // 正文里出现的是任意字符夹在中间，如果 % / _ 被当通配符会误命中；
      // 只有正文里出现字面量 "50%_off" 才应该判 post_sale。
      stubMessages([{ body: '随便什么内容都不该命中', sent_at: iso(0) }])
      const policy = {
        postSaleKeywords: ['50%_off'],
        postSaleSpanMs: 30 * 24 * 60 * 60 * 1000,
      }
      await expect(classifyConversation(CONVO, policy)).resolves.toBe('lead_intake')
    })

    it('空关键词数组不抛错，也不会生成无效的 .or(\'\')', async () => {
      stubMessages([{ body: '你好，请问有没有团期', sent_at: iso(0) }])
      const policy = { postSaleKeywords: [], postSaleSpanMs: 30 * 24 * 60 * 60 * 1000 }
      await expect(classifyConversation(CONVO, policy)).resolves.toBe('lead_intake')
    })
  })

  it('查询报错要往上抛，不能吞掉当作"没有消息"', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table !== 'conversation_messages') throw new Error(`fake supabase: 表 '${table}' 没建模`)
      const error = { message: 'network down' }
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        or: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: null, error }),
        then: (resolve: (v: { data: null; error: typeof error }) => unknown) =>
          Promise.resolve({ data: null, error }).then(resolve),
      }
      return chain as never
    })
    await expect(classifyConversation(CONVO, TOURISM_POST_SALE_POLICY)).rejects.toThrow('network down')
  })
})
