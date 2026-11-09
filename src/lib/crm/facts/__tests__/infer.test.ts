import { beforeEach, describe, it, expect, vi } from 'vitest'
import {
  CLAIM_STALE_MS,
  RETRY_AFTER_MS,
  RUN_BUDGET_MS,
  clearFactsCache,
  inferConversationFacts,
  needsFacts,
  pickCandidates,
  readFactsConfig,
  type FactsConfig,
  type RunOptions,
} from '../infer'
import type { ConvRow, FactsIo, FactsRow } from '../io'
import type { Facts } from '../schema'
import type { FactsMsg } from '../canned'

// 进程内缓存（客户口径）会在测试之间串味 —— 每条测试前清掉。
beforeEach(() => clearFactsCache())

const CLIENT = '11111111-1111-1111-1111-111111111111'
const CONV_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const CONV_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

function baseFacts(over: Partial<Facts> = {}): Facts {
  return {
    spam_kind: 'none',
    is_spam_or_unrelated: false,
    customer_gave_specifics: true,
    we_gave_price: false,
    next_step_arranged: false,
    ordered_or_paid: false,
    we_declined: false,
    customer_said_not_now: false,
    decline_quote: '',
    customer_quote: 'I need 20 tons to Auckland',
    our_quote: '',
    progression: '从询价聊到了细节',
    reason: '客户给了具体需求',
    ...over,
  }
}

function msg(direction: 'inbound' | 'outbound', body: string, at: string): FactsMsg {
  return { direction, body, sent_at: at }
}

function conv(id: string, last: string | null = '2026-10-11T00:00:00.000Z'): ConvRow {
  return { id, client_id: CLIENT, channel: 'messenger', last_message_at: last }
}

function fakeIo(over: Partial<FactsIo> = {}): FactsIo {
  return {
    listConversations: vi.fn(async () => [] as ConvRow[]),
    listFactsRows: vi.fn(async () => [] as FactsRow[]),
    loadMessages: vi.fn(async () => [] as FactsMsg[]),
    loadClientOutbound: vi.fn(async () => [] as Array<Array<string | null>>),
    businessName: vi.fn(async () => 'CTS'),
    claim: vi.fn(async () => true),
    ask: vi.fn(async () => ({ facts: baseFacts(), inputTokens: 100, outputTokens: 50 })),
    writeReady: vi.fn(async () => true),
    writeFailed: vi.fn(async () => undefined),
    markEmpty: vi.fn(async () => undefined),
    ...over,
  }
}

function config(over: Partial<FactsConfig> = {}): FactsConfig {
  return { clientIds: [CLIENT], model: 'gpt-4o', dailyLimit: 80, perRun: 5, ...over }
}

const NOW = new Date('2026-10-11T12:00:00.000Z')

describe('readFactsConfig', () => {
  it('unset → clientIds []', () => {
    expect(readFactsConfig({}).clientIds).toEqual([])
  })

  it('drops garbage ids, keeps valid ones', () => {
    const cfg = readFactsConfig({ CRM_FACTS_CLIENT_IDS: `nope, ${CLIENT} ,also-bad` })
    expect(cfg.clientIds).toEqual([CLIENT])
  })

  it('defaults model/limit/perRun', () => {
    const cfg = readFactsConfig({})
    expect(cfg.model).toBe('gpt-4o')
    expect(cfg.dailyLimit).toBe(80)
    expect(cfg.perRun).toBe(5)
  })

  it('caps perRun at 20', () => {
    expect(readFactsConfig({ CRM_FACTS_PER_RUN: '99' }).perRun).toBe(20)
  })

  it('negative limit → 80', () => {
    expect(readFactsConfig({ CRM_FACTS_DAILY_LIMIT: '-3' }).dailyLimit).toBe(80)
  })
})

describe('needsFacts', () => {
  const c = conv(CONV_A, '2026-10-11T00:00:00.000Z')

  it('no row → true', () => {
    expect(needsFacts(c, null, NOW)).toBe(true)
  })

  it('ready + same last_message_at → false', () => {
    const row: FactsRow = {
      conversation_id: CONV_A,
      status: 'ready',
      claimed_at: null,
      retry_after: null,
      last_message_at: '2026-10-11T00:00:00.000Z',
    }
    expect(needsFacts(c, row, NOW)).toBe(false)
  })

  it('ready + newer conversation → true', () => {
    const row: FactsRow = {
      conversation_id: CONV_A,
      status: 'ready',
      claimed_at: null,
      retry_after: null,
      last_message_at: '2026-10-10T00:00:00.000Z',
    }
    expect(needsFacts(c, row, NOW)).toBe(true)
  })

  it('pending fresh → false', () => {
    const row: FactsRow = {
      conversation_id: CONV_A,
      status: 'pending',
      claimed_at: new Date(NOW.getTime() - 1000).toISOString(),
      retry_after: null,
      last_message_at: null,
    }
    expect(needsFacts(c, row, NOW)).toBe(false)
  })

  it('pending stale → true', () => {
    const row: FactsRow = {
      conversation_id: CONV_A,
      status: 'pending',
      claimed_at: new Date(NOW.getTime() - CLAIM_STALE_MS - 1000).toISOString(),
      retry_after: null,
      last_message_at: null,
    }
    expect(needsFacts(c, row, NOW)).toBe(true)
  })

  it('failed before retry_after → false', () => {
    const row: FactsRow = {
      conversation_id: CONV_A,
      status: 'failed',
      claimed_at: null,
      retry_after: new Date(NOW.getTime() + 1000).toISOString(),
      last_message_at: null,
    }
    expect(needsFacts(c, row, NOW)).toBe(false)
  })

  it('failed after retry_after → true', () => {
    const row: FactsRow = {
      conversation_id: CONV_A,
      status: 'failed',
      claimed_at: null,
      retry_after: new Date(NOW.getTime() - 1000).toISOString(),
      last_message_at: null,
    }
    expect(needsFacts(c, row, NOW)).toBe(true)
  })
})

describe('pickCandidates', () => {
  it('keeps order and respects limit', () => {
    const convs = [conv(CONV_A), conv(CONV_B)]
    const picked = pickCandidates(convs, [], NOW, 1)
    expect(picked.map((c) => c.id)).toEqual([CONV_A])
  })
})

describe('inferConversationFacts', () => {
  it('off by default: empty clientIds, no only-ids', async () => {
    const io = fakeIo()
    const res = await inferConversationFacts(NOW, { io, config: config({ clientIds: [] }) })
    expect(res.enabled).toBe(false)
    expect(res.reason).toBe('off')
    expect(io.listConversations).not.toHaveBeenCalled()
  })

  it('no key → reason no_key, no io calls', async () => {
    const io = fakeIo()
    const res = await inferConversationFacts(NOW, { io, config: config(), hasKey: false })
    expect(res.enabled).toBe(false)
    expect(res.reason).toBe('no_key')
    expect(io.listConversations).not.toHaveBeenCalled()
  })

  it('happy path: claim, ask, writeReady', async () => {
    const io = fakeIo({
      listConversations: vi.fn(async () => [conv(CONV_A)]),
      loadMessages: vi.fn(async () => [
        msg('inbound', 'I need 20 tons to Auckland', '2026-10-11T00:00:00.000Z'),
        msg('outbound', 'Sure, let me check', '2026-10-11T00:01:00.000Z'),
        msg('inbound', 'Thanks', '2026-10-11T00:02:00.000Z'),
      ]),
    })
    const res = await inferConversationFacts(NOW, { io, config: config(), hasKey: true })
    expect(io.claim).toHaveBeenCalledTimes(1)
    expect(io.claim).toHaveBeenCalledWith(CONV_A, CLIENT, 80)
    expect(io.ask).toHaveBeenCalledTimes(1)
    expect(io.writeReady).toHaveBeenCalledTimes(1)
    const arg = (io.writeReady as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg.sourceMessageCount).toBe(3)
    expect(arg.lastSpeaker).toBe('customer')
    expect(res).toMatchObject({ claimed: 1, written: 1, failed: 0 })
  })

  it('claim false → no ask, no write, notClaimed', async () => {
    const io = fakeIo({
      listConversations: vi.fn(async () => [conv(CONV_A)]),
      loadMessages: vi.fn(async () => [msg('inbound', 'hi there friend', '2026-10-11T00:00:00.000Z')]),
      claim: vi.fn(async () => false),
    })
    const res = await inferConversationFacts(NOW, { io, config: config(), hasKey: true })
    expect(io.ask).not.toHaveBeenCalled()
    expect(io.writeReady).not.toHaveBeenCalled()
    expect(res.notClaimed).toBe(1)
  })

  it('ask throws for first candidate, second still processed', async () => {
    let call = 0
    const io = fakeIo({
      listConversations: vi.fn(async () => [conv(CONV_A), conv(CONV_B)]),
      loadMessages: vi.fn(async () => [msg('inbound', 'hello there friend', '2026-10-11T00:00:00.000Z')]),
      ask: vi.fn(async () => {
        call++
        if (call === 1) throw new Error('boom')
        return { facts: baseFacts(), inputTokens: 10, outputTokens: 5 }
      }),
    })
    const res = await inferConversationFacts(NOW, { io, config: config(), hasKey: true })
    expect(io.writeFailed).toHaveBeenCalledTimes(1)
    const [, , retryAfter] = (io.writeFailed as ReturnType<typeof vi.fn>).mock.calls[0]
    expect((retryAfter as Date).getTime()).toBe(NOW.getTime() + RETRY_AFTER_MS)
    expect(res.failed).toBe(1)
    expect(res.written).toBe(1)
  })

  it('ask returns facts:null → failed path', async () => {
    const io = fakeIo({
      listConversations: vi.fn(async () => [conv(CONV_A)]),
      loadMessages: vi.fn(async () => [msg('inbound', 'hello there friend', '2026-10-11T00:00:00.000Z')]),
      ask: vi.fn(async () => ({ facts: null, inputTokens: 0, outputTokens: 0 })),
    })
    const res = await inferConversationFacts(NOW, { io, config: config(), hasKey: true })
    expect(io.writeFailed).toHaveBeenCalledTimes(1)
    expect(res.failed).toBe(1)
    expect(res.written).toBe(0)
  })

  it('dry-run: no writes, masked quotes', async () => {
    const io = fakeIo({
      listConversations: vi.fn(async () => [conv(CONV_A)]),
      loadMessages: vi.fn(async () => [msg('inbound', 'I need 20 tons to Auckland', '2026-10-11T00:00:00.000Z')]),
    })
    const res = await inferConversationFacts(NOW, {
      io,
      config: config(),
      hasKey: true,
      dryRun: true,
    })
    expect(io.claim).not.toHaveBeenCalled()
    expect(io.writeReady).not.toHaveBeenCalled()
    expect(io.writeFailed).not.toHaveBeenCalled()
    expect(res.dryRun).toBeDefined()
    for (const entry of res.dryRun ?? []) {
      expect(entry.facts.decline_quote).toBe('')
      expect(entry.facts.customer_quote).toBe('')
      expect(entry.facts.our_quote).toBe('')
      expect(entry.facts.progression).toBe('')
      expect(entry.facts.reason).toBe('')
    }
  })

  it('zero messages → 不抢占不问模型，但写一行 failed+6h 标记，别天天占名额', async () => {
    const markEmpty = vi.fn(async () => undefined)
    const io = fakeIo({
      listConversations: vi.fn(async () => [conv(CONV_A)]),
      loadMessages: vi.fn(async () => []),
      markEmpty,
    })
    const res = await inferConversationFacts(NOW, { io, config: config(), hasKey: true })
    expect(io.claim).not.toHaveBeenCalled()
    expect(io.ask).not.toHaveBeenCalled()
    expect(markEmpty).toHaveBeenCalledTimes(1)
    const retryAfter = (markEmpty.mock.calls[0] as unknown[])[2] as Date
    expect(retryAfter.getTime() - NOW.getTime()).toBe(RETRY_AFTER_MS)
    expect(res.claimed).toBe(0)
    expect(res.failed).toBe(0)
  })

  it('干跑遇到空对话：什么都不写', async () => {
    const markEmpty = vi.fn(async () => undefined)
    const io = fakeIo({
      listConversations: vi.fn(async () => [conv(CONV_A)]),
      loadMessages: vi.fn(async () => []),
      markEmpty,
    })
    await inferConversationFacts(NOW, { io, config: config(), hasKey: true, dryRun: true, onlyConversationIds: [CONV_A] })
    expect(markEmpty).not.toHaveBeenCalled()
  })

  it('🔴 onlyConversationIds 不带 dryRun → 直接抛错（旁路不许真写库）', async () => {
    const io = fakeIo()
    await expect(
      inferConversationFacts(NOW, { io, config: config({ clientIds: [] }), hasKey: true, onlyConversationIds: [CONV_A] }),
    ).rejects.toThrow(/dryRun/)
    expect(io.listConversations).not.toHaveBeenCalled()
    expect(io.claim).not.toHaveBeenCalled()
  })

  it('同一进程里同一客户的「固定回复」口径 30 分钟内只读一次', async () => {
    clearFactsCache()
    const loadClientOutbound = vi.fn(async () => [[]] as Array<Array<string | null>>)
    const mk = () =>
      fakeIo({
        listConversations: vi.fn(async () => [conv(CONV_A)]),
        loadMessages: vi.fn(async () => [msg('inbound', 'need 2 pallets to Auckland please', '2026-10-11T00:00:00.000Z')]),
        loadClientOutbound,
      })
    await inferConversationFacts(NOW, { io: mk(), config: config(), hasKey: true })
    await inferConversationFacts(NOW, { io: mk(), config: config(), hasKey: true })
    expect(loadClientOutbound).toHaveBeenCalledTimes(1)
    clearFactsCache()
  })

  it('run budget: second candidate never starts', async () => {
    // 时钟序列：开始 → 第一个候选开始前检查 → 第二个候选开始前检查（此时已超预算）。
    const ticks = [0, 0, RUN_BUDGET_MS + 1]
    let i = 0
    const nowMs = () => ticks[Math.min(i++, ticks.length - 1)]
    const io = fakeIo({
      listConversations: vi.fn(async () => [conv(CONV_A), conv(CONV_B)]),
      loadMessages: vi.fn(async () => [msg('inbound', 'hello there friend', '2026-10-11T00:00:00.000Z')]),
    })
    const res = await inferConversationFacts(NOW, {
      io,
      config: config(),
      hasKey: true,
      nowMs,
    })
    expect(io.ask).toHaveBeenCalledTimes(1)
    expect(res.written).toBe(1)
  })

  it('sanitize applied: ungrounded decline → we_declined false', async () => {
    const io = fakeIo({
      listConversations: vi.fn(async () => [conv(CONV_A)]),
      loadMessages: vi.fn(async () => [
        msg('inbound', 'Can you ship to Auckland?', '2026-10-11T00:00:00.000Z'),
      ]),
      ask: vi.fn(async () => ({
        facts: baseFacts({ we_declined: true, decline_quote: 'we cannot do that at all' }),
        inputTokens: 10,
        outputTokens: 5,
      })),
    })
    await inferConversationFacts(NOW, { io, config: config(), hasKey: true })
    const arg = (io.writeReady as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg.facts.we_declined).toBe(false)
  })
})
