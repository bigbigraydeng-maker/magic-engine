/**
 * `runFailedWritebackResend()` 测试——令牌修好后自动补发授权失败的已批准记录。
 *
 * 假 Supabase 按表建模（跟同目录其它测试同一原则）：真的按状态/错误码/时间过滤，
 * 不是按调用顺序返回预设值——这里唯一要紧的就是「挑了哪些行、没挑哪些行」。
 * 发送本身 mock 掉：那是 `writeback-service.test.ts` 的事。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../writeback-service', () => ({
  sendApprovedOutcome: vi.fn(async (outcomeId: string, _deps?: unknown, _scope?: { eventId: string }) => ({
    status: 'confirmed' as const,
    message: '已发送',
    writebackId: `wb-${outcomeId}`,
  })),
}))

import { sendApprovedOutcome } from '../writeback-service'
import { runFailedWritebackResend, RESEND_ACTOR } from '../writeback-resend-run'
import type { DestinationWriter } from '../destination-writer'

type Row = Record<string, unknown>
const NOW = new Date('2026-09-22T18:00:00.000Z')
const CLIENT = 'c0000000-0000-0000-0000-000000000000'

let writebacks: Row[]
let outcomes: Row[]
let clients: Row[]
let audits: Row[]

/**
 * 实测核实（对着 writeback-resend-run.ts 源码逐条查过）：三张表只走
 * select → eq/is/in/lte/order/limit → await（或 maybeSingle）；审计表只 insert。
 * 假件按这条链实现，过滤按真语义执行。
 */
function fakeDb(table: string) {
  const src = (): Row[] =>
    table === 'me_conversion_writebacks' ? writebacks : table === 'me_sale_outcomes' ? outcomes : table === 'clients' ? clients : []
  const filters: Array<(r: Row) => boolean> = []
  let limitN: number | null = null
  const rows = () => {
    let out = src().filter((r) => filters.every((f) => f(r)))
    if (limitN != null) out = out.slice(0, limitN)
    return out
  }
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
    is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), b),
    in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), b),
    lte: (c: string, v: string) => (filters.push((r) => typeof r[c] === 'string' && (r[c] as string) <= v), b),
    order: () => b,
    limit: (n: number) => ((limitN = n), b),
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    insert: async (row: Row) => {
      if (table === 'me_conversion_audit') audits.push(row)
      return { data: null, error: null }
    },
    then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: rows(), error: null }),
  }
  return b
}
const supabase = { from: vi.fn(fakeDb) }

/**
 * 实测核实：writeback-resend-run.ts 对 writer 只读 `.kind` 和调 `.preflight(config, { fetcher })`
 * 两项（发送在 mock 掉的 sendApprovedOutcome 里），假件只实现这两项，其余成员不会被碰到。
 */
function writer(preflightOk: boolean) {
  const preflight = vi.fn(async () => ({ ok: preflightOk, detail: {} }))
  const partial: Pick<DestinationWriter<unknown>, 'kind' | 'maxEventAgeDays' | 'preflight'> = {
    kind: 'meta_capi',
    maxEventAgeDays: 7,
    preflight,
  }
  return { w: partial as DestinationWriter<unknown>, preflight }
}

function wb(over: Row): Row {
  return {
    id: `wb-${over.outcome_id}`,
    destination: 'meta_capi',
    status: 'failed',
    last_error_code: 'auth',
    next_attempt_at: '2026-09-22T10:00:00.000Z',
    last_attempt_at: '2026-09-22T09:00:00.000Z',
    event_id: over.outcome_id,
    ...over,
  }
}
function outcome(id: string, over: Row = {}): Row {
  return { id, client_id: CLIENT, review_status: 'approved', redacted_at: null, ...over }
}

function run(preflightOk = true) {
  const { w, preflight } = writer(preflightOk)
  return {
    preflight,
    result: runFailedWritebackResend(CLIENT, { supabase: supabase as never, sendDeps: { writer: w, fetcher: fetch }, now: NOW }),
  }
}

beforeEach(() => {
  writebacks = []
  outcomes = []
  audits = []
  clients = [{ id: CLIENT, default_phone_country: '64', facebook_page_id: null }]
  vi.mocked(sendApprovedOutcome).mockClear()
})

describe('runFailedWritebackResend', () => {
  it('令牌活了 → 授权失败的已批准记录逐条走 sendApprovedOutcome，并写 resent 审计（actor 不是 AI 身份）', async () => {
    writebacks.push(wb({ outcome_id: 'o1' }), wb({ outcome_id: 'o2' }))
    outcomes.push(outcome('o1'), outcome('o2'))
    const { result, preflight } = run(true)
    const s = await result
    expect(preflight).toHaveBeenCalledTimes(1)
    expect(s).toMatchObject({ candidates: 2, preflightOk: true, sent: 2, skippedTokenDead: 0 })
    expect(sendApprovedOutcome).toHaveBeenCalledTimes(2)
    expect(audits).toHaveLength(2)
    expect(audits[0]).toMatchObject({ action: 'resent', actor: RESEND_ACTOR, detail: { trigger: 'auth_recovered' } })
    expect(RESEND_ACTOR).not.toBe('ai-auto-review@system')
  })

  it('🔴 发送不透传判断用的 now（状态机用真实时间写 last_attempt_at）', async () => {
    writebacks.push(wb({ outcome_id: 'o1' }))
    outcomes.push(outcome('o1'))
    await run(true).result
    const sendDeps = vi.mocked(sendApprovedOutcome).mock.calls[0][1]
    expect(sendDeps).not.toHaveProperty('now')
  })

  it('🔴 令牌还没修好 → 一条都不发、不烧尝试次数，summary 说清跳过了几条', async () => {
    writebacks.push(wb({ outcome_id: 'o1' }))
    outcomes.push(outcome('o1'))
    const s = await run(false).result
    expect(s).toMatchObject({ candidates: 1, preflightOk: false, skippedTokenDead: 1, sent: 0 })
    expect(sendApprovedOutcome).not.toHaveBeenCalled()
  })

  it('🔴 只挑 last_error_code=auth：限流/5xx 的 retry 行留给人（5xx 时事件可能已入账）', async () => {
    writebacks.push(wb({ outcome_id: 'o1', last_error_code: 'retry' }), wb({ outcome_id: 'o2', last_error_code: 'permanent' }))
    outcomes.push(outcome('o1'), outcome('o2'))
    const { result, preflight } = run(true)
    const s = await result
    expect(s.candidates).toBe(0)
    expect(preflight).not.toHaveBeenCalled()
    expect(sendApprovedOutcome).not.toHaveBeenCalled()
  })

  it('next_attempt_at 还没到的不挑', async () => {
    writebacks.push(wb({ outcome_id: 'o1', next_attempt_at: '2026-09-23T00:00:00.000Z' }))
    outcomes.push(outcome('o1'))
    const s = await run(true).result
    expect(s.candidates).toBe(0)
  })

  it('用 outcome 表收口：别的客户 / 没批准 / 已删个人信息的都不发', async () => {
    writebacks.push(wb({ outcome_id: 'other' }), wb({ outcome_id: 'pending' }), wb({ outcome_id: 'redacted' }), wb({ outcome_id: 'mine' }))
    outcomes.push(
      outcome('other', { client_id: 'someone-else' }),
      outcome('pending', { review_status: 'pending_review' }),
      outcome('redacted', { redacted_at: '2026-09-01T00:00:00Z' }),
      outcome('mine'),
    )
    const s = await run(true).result
    expect(s.candidates).toBe(1)
    expect(vi.mocked(sendApprovedOutcome).mock.calls.map((c) => c[0])).toEqual(['mine'])
  })

  it('只看本目的地（destination）的发送记录', async () => {
    writebacks.push(wb({ outcome_id: 'o1', destination: 'meta_custom_audience' }))
    outcomes.push(outcome('o1'))
    const s = await run(true).result
    expect(s.candidates).toBe(0)
  })

  it('卡在 sending 超过 5 分钟的行也推给状态机（它会转 in_doubt 交人，绝不重发），令牌探活与它无关', async () => {
    writebacks.push(wb({ outcome_id: 'stuck', status: 'sending', last_error_code: null, last_attempt_at: '2026-09-22T17:00:00.000Z' }))
    writebacks.push(wb({ outcome_id: 'fresh', status: 'sending', last_error_code: null, last_attempt_at: '2026-09-22T17:58:00.000Z' }))
    outcomes.push(outcome('stuck'), outcome('fresh'))
    vi.mocked(sendApprovedOutcome).mockResolvedValueOnce({ status: 'in_doubt', message: '等人核对', writebackId: 'wb-stuck' })
    const { result, preflight } = run(false)
    const s = await result
    expect(preflight).not.toHaveBeenCalled()
    expect(s).toMatchObject({ candidates: 1, inDoubt: 1 })
    expect(vi.mocked(sendApprovedOutcome).mock.calls.map((c) => c[0])).toEqual(['stuck'])
    expect(vi.mocked(sendApprovedOutcome).mock.calls[0]?.[2]).toEqual({ eventId: 'stuck' })
    expect(audits[0]).toMatchObject({ detail: { trigger: 'stuck_sending' } })
  })

  it('选中阶段那条时，只把这一条的事件编号交给发送，不让整笔再走一遍', async () => {
    writebacks.push(wb({
      id: 'wb-stage',
      outcome_id: 'o1',
      event_id: 'o1:conversion-stage',
    }))
    outcomes.push(outcome('o1'))
    await run(true).result
    expect(sendApprovedOutcome).toHaveBeenCalledTimes(1)
    expect(vi.mocked(sendApprovedOutcome).mock.calls[0]?.[0]).toBe('o1')
    expect(vi.mocked(sendApprovedOutcome).mock.calls[0]?.[2]).toEqual({ eventId: 'o1:conversion-stage' })
  })

  it('单条发送抛错不影响其它条，记进 errors', async () => {
    writebacks.push(wb({ outcome_id: 'o1' }), wb({ outcome_id: 'o2' }))
    outcomes.push(outcome('o1'), outcome('o2'))
    vi.mocked(sendApprovedOutcome).mockRejectedValueOnce(new Error('模拟断网'))
    const s = await run(true).result
    expect(s.errors).toEqual([{ outcomeId: 'o1', error: '模拟断网' }])
    expect(s.sent).toBe(1)
  })

  it('过期由 sendApprovedOutcome 自己判（这里不重复判），计进 expired', async () => {
    writebacks.push(wb({ outcome_id: 'o1' }))
    outcomes.push(outcome('o1'))
    vi.mocked(sendApprovedOutcome).mockResolvedValueOnce({ status: 'expired_no_send', message: '太旧', writebackId: 'wb-o1' })
    const s = await run(true).result
    expect(s).toMatchObject({ expired: 1, sent: 0 })
  })
})
