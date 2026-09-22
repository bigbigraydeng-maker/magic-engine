/**
 * 状态机测试（Issue #1397 PR3）。
 *
 * 🔴 假数据库**按表建模**，不是按调用顺序返回预设值。
 *    按顺序返回的假件只能证明"代码按我想的顺序调了几次"，
 *    证明不了"并发时不会发两次" —— 而那正是这里唯一要紧的事。
 *    所以下面这个假件真的存行、真的执行条件更新的语义（改到几行就返回几行）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sendApprovedOutcome, resolveDoubt } from '../writeback-service'
import type { DestinationWriter, RawSendResult, SendVerdict } from '../destination-writer'

// ── 假数据库：按表存行，条件更新按真语义执行 ─────────────────────────────
type Row = Record<string, unknown>

class FakeDb {
  tables: Record<string, Row[]> = {
    me_sale_outcomes: [],
    me_conversion_writebacks: [],
    clients: [],
    contacts: [],
    contact_touchpoints: [],
  }

  /** 按表名注入一次性查询失败，测「查不到就当放行」这类假开的坑。 */
  errorOn: Partial<Record<string, { message: string }>> = {}

  from(table: string) {
    const failure = this.errorOn[table]
    const rows = this.tables[table] ?? []
    const q: {
      _filters: Array<(r: Row) => boolean>
      _op: 'select' | 'update' | 'insert'
      _patch: Row
      select: (...a: unknown[]) => typeof q
      eq: (c: string, v: unknown) => typeof q
      is: (c: string, v: unknown) => typeof q
      in: (c: string, v: unknown[]) => typeof q
      update: (p: Row) => typeof q
      insert: (r: Row) => Promise<{ data: null; error: { message: string; code?: string } | null }>
      maybeSingle: () => Promise<{ data: Row | null; error: { message: string } | null }>
      then: (
        res: (v: { data: Row[] | null; error: { message: string } | null }) => unknown,
      ) => Promise<unknown>
    } = {
      _filters: [],
      _op: 'select',
      _patch: {},
      select() {
        return q
      },
      eq(col: string, val: unknown) {
        q._filters.push((r) => r[col] === val)
        return q
      },
      is(col: string, val: unknown) {
        q._filters.push((r) => (r[col] ?? null) === val)
        return q
      },
      in(col: string, vals: unknown[]) {
        q._filters.push((r) => vals.includes(r[col]))
        return q
      },
      update(patch: Row) {
        q._op = 'update'
        q._patch = patch
        return q
      },
      insert: async (row: Row) => {
        // 真的执行 (destination, event_id) 唯一约束
        if (table === 'me_conversion_writebacks') {
          const dup = rows.some(
            (r) => r.destination === row.destination && r.event_id === row.event_id,
          )
          // 真库（PostgREST）唯一冲突返回的是**错误码 23505**，文案只是附带。
          // 代码若认文案不认码，换个 Postgres 版本或语言就会把正常并发当成故障。
          if (dup) {
            return {
              data: null,
              error: { code: '23505', message: 'duplicate key value violates unique constraint' },
            }
          }
        }
        rows.push({ id: `wb-${rows.length + 1}`, attempts: 0, post_started_at: null, ...row })
        return { data: null, error: null }
      },
      maybeSingle: async () => {
        if (failure) return { data: null, error: failure }
        const hit = rows.find((r) => q._filters.every((f) => f(r)))
        return { data: hit ?? null, error: null }
      },
      then: async (resolve) => {
        if (failure) return resolve({ data: null, error: failure })
        const matched = rows.filter((r) => q._filters.every((f) => f(r)))
        if (q._op === 'update') {
          // 条件更新的真语义：只改命中的行，返回改到的行数
          for (const r of matched) Object.assign(r, q._patch)
        }
        return resolve({ data: matched, error: null })
      },
    }
    return q
  }
}

// ── 假的目的地：默认成功，可按用例改 ─────────────────────────────────────
function makeWriter(over: Partial<DestinationWriter<unknown>> = {}) {
  const sendSpy = vi.fn<(...a: never[]) => Promise<RawSendResult>>().mockResolvedValue({
    ok: true,
    status: 200,
    headers: {},
    bodyText: '{"events_received":1}',
    latencyMs: 10,
  })
  const writer: DestinationWriter<unknown> & { sendSpy: typeof sendSpy } = {
    kind: 'meta_capi',
    maxEventAgeDays: 7,
    build: () => ({ data: [] }),
    preview: () => ({ 客户: '打码' }),
    preflight: async () => ({ ok: true, detail: {} }),
    send: sendSpy as unknown as DestinationWriter<unknown>['send'],
    accept: (): SendVerdict => ({ kind: 'accepted', receipt: { events_received: 1 } }),
    sendSpy,
    ...over,
  } as DestinationWriter<unknown> & { sendSpy: typeof sendSpy }
  return writer
}

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const OUTCOME = '11111111-2222-3333-4444-555555555555'

function seed(
  db: FakeDb,
  over: { outcome?: Row; client?: Row; contact?: Row; touchpoints?: Row[] } = {},
) {
  db.tables.clients.push({
    id: CLIENT,
    default_phone_country: '64',
    conversion_stage: 'live',
    facebook_page_id: null,
    ...over.client,
  })
  db.tables.me_sale_outcomes.push({
    id: OUTCOME,
    client_id: CLIENT,
    contact_id: null,
    outcome_kind: 'purchase',
    customer_email: 'rosalind@example.com',
    customer_phone: null,
    customer_first: null,
    customer_last: null,
    order_ref: '84191',
    amount_minor: 388000,
    currency: 'NZD',
    occurred_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    review_status: 'approved',
    redacted_at: null,
    page_scoped_user_id: null,
    source_kind: 'manual_seed',
    ...over.outcome,
  })
  if (over.contact) db.tables.contacts.push(over.contact)
  if (over.touchpoints) db.tables.contact_touchpoints.push(...over.touchpoints)
}

function deps(db: FakeDb, writer = makeWriter()) {
  return {
    supabase: db as never,
    writer,
    fetcher: vi.fn() as unknown as typeof fetch,
  }
}

let db: FakeDb
beforeEach(() => {
  db = new FakeDb()
})

// ─────────────────────────────────────────────────────────────────────────
describe('正常路径', () => {
  it('已批准的成交发出去并记为已确认', async () => {
    seed(db)
    const w = makeWriter()
    const r = await sendApprovedOutcome(OUTCOME, deps(db, w))
    expect(r.status).toBe('confirmed')
    expect(w.sendSpy).toHaveBeenCalledTimes(1)
    expect(db.tables.me_conversion_writebacks[0].status).toBe('confirmed')
  })

  it('回执落库', async () => {
    seed(db)
    await sendApprovedOutcome(OUTCOME, deps(db))
    expect(db.tables.me_conversion_writebacks[0].receipt).toMatchObject({ events_received: 1 })
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('🔴 绝不重复发送（这是全套设计的要害）', () => {
  it('同一条连点两次，只真的发一次', async () => {
    // Meta 服务端事件之间没有去重、也没有删除端点 ——
    // 发两次就是永久多记一笔成交，撤不回。
    seed(db)
    const w = makeWriter()
    await sendApprovedOutcome(OUTCOME, deps(db, w))
    const second = await sendApprovedOutcome(OUTCOME, deps(db, w))

    expect(w.sendSpy).toHaveBeenCalledTimes(1)
    expect(second.status).toBe('confirmed')
    expect(second.message).toContain('不会重复发送')
    expect(db.tables.me_conversion_writebacks).toHaveLength(1)
  })

  it('已经是终态的，一律不再发，而且当场就停', async () => {
    // 断言分两层，缺一条这测试就分辨不出闸有没有被拆：
    //   · 不发 —— 安全性质。这一条即使去掉终态判断也仍然成立，
    //     因为下面的「状态条件更新」会兜住（两道闸叠加，正是不可逆操作该有的样子）。
    //   · 连组装都没发生 —— 这才是终态判断**自己**的可观察行为。
    //     没有这一条，变异测试拆掉终态判断也不会红（2026-09-05 实测漏网）。
    for (const status of ['confirmed', 'failed_permanent', 'expired_no_send', 'redacted', 'in_doubt', 'dry_run']) {
      db = new FakeDb()
      seed(db)
      db.tables.me_conversion_writebacks.push({
        id: 'wb-x', outcome_id: OUTCOME, destination: 'meta_capi', event_id: OUTCOME,
        status, attempts: 1, post_started_at: null,
      })
      const buildSpy = vi.fn().mockReturnValue({ data: [] })
      const w = makeWriter({ build: buildSpy })
      const r = await sendApprovedOutcome(OUTCOME, deps(db, w))

      expect(w.sendSpy, `状态 ${status} 不该再发`).not.toHaveBeenCalled()
      expect(buildSpy, `状态 ${status} 应当在组装之前就返回`).not.toHaveBeenCalled()
      expect(r.status).toBe(status)
    }
  })

  it('上次发到一半断了 → 转「不确定」，绝不自动重发', async () => {
    seed(db)
    db.tables.me_conversion_writebacks.push({
      id: 'wb-x', outcome_id: OUTCOME, destination: 'meta_capi', event_id: OUTCOME,
      status: 'sending', attempts: 1, post_started_at: new Date().toISOString(),
    })
    const w = makeWriter()
    const r = await sendApprovedOutcome(OUTCOME, deps(db, w))

    expect(w.sendSpy).not.toHaveBeenCalled()
    expect(r.status).toBe('in_doubt')
    expect(r.message).toContain('不会自动重发')
  })

  it('🔴 发送标记被别人抢走时不发（真实并发时序）', async () => {
    // 时序很关键，第一版测试就写错过：
    //   代码是「先把状态改成 sending 并**清空**标记 → 再抢标记」。
    //   在清空之前注入，会被清空动作覆盖掉，模拟不出竞争。
    //   真正的窗口在这两步**之间** —— 另一个进程在那一瞬把标记占了。
    seed(db)
    const w = makeWriter()

    const origFrom = db.from.bind(db)
    let raced = false
    vi.spyOn(db, 'from').mockImplementation((t: string) => {
      const q = origFrom(t)
      if (t === 'me_conversion_writebacks') {
        const origUpdate = q.update.bind(q)
        q.update = (patch: Row) => {
          const chain = origUpdate(patch)
          if (patch.status === 'sending' && !raced) {
            raced = true
            const origThen = chain.then.bind(chain)
            chain.then = async (resolve) => {
              const out = await origThen(resolve)
              // 清空动作已经落地，此刻另一个进程抢先占了标记
              db.tables.me_conversion_writebacks[0].post_started_at = new Date().toISOString()
              return out
            }
          }
          return chain
        }
      }
      return q
    })

    const r = await sendApprovedOutcome(OUTCOME, deps(db, w))
    expect(raced, '没模拟到竞争，这条测试就没意义').toBe(true)
    expect(w.sendSpy, '标记抢不到就绝不能发').not.toHaveBeenCalled()
    expect(r.status).toBe('in_doubt')
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('不该发的都不发', () => {
  it('没批准的不发', async () => {
    seed(db, { outcome: { review_status: 'pending_review' } })
    const w = makeWriter()
    const r = await sendApprovedOutcome(OUTCOME, deps(db, w))
    expect(w.sendSpy).not.toHaveBeenCalled()
    expect(r.message).toContain('还没有被批准')
  })

  it('已按客人要求删除个人信息的不发', async () => {
    seed(db, { outcome: { redacted_at: new Date().toISOString() } })
    const w = makeWriter()
    await sendApprovedOutcome(OUTCOME, deps(db, w))
    expect(w.sendSpy).not.toHaveBeenCalled()
  })

  it('客人说过「别再联系我」的不发', async () => {
    // 用既有的 contacts.do_not_contact，不另建退出名单表。
    seed(db, {
      outcome: { contact_id: 'ct-1' },
      contact: { id: 'ct-1', do_not_contact: true },
    })
    const w = makeWriter()
    const r = await sendApprovedOutcome(OUTCOME, deps(db, w))
    expect(w.sendSpy).not.toHaveBeenCalled()
    expect(r.message).toContain('别再联系')
  })

  it('私信里刚说过「别再联系」、contacts 那一列还没来得及更新的，也不发', async () => {
    // 🔴 回归测试：修复前这里只查 contacts.do_not_contact（还是 false），
    // 会把明确拒联的客人数据发出去。真相源是触点，不是那一列——
    // 见 src/lib/crm/dnc.ts。
    seed(db, {
      outcome: { contact_id: 'ct-1' },
      contact: { id: 'ct-1', do_not_contact: false },
      touchpoints: [
        {
          contact_id: 'ct-1',
          client_id: CLIENT,
          occurred_at: new Date().toISOString(),
          metadata: { outcome: 'do_not_contact' },
        },
      ],
    })
    const w = makeWriter()
    const r = await sendApprovedOutcome(OUTCOME, deps(db, w))
    expect(w.sendSpy).not.toHaveBeenCalled()
    expect(r.message).toContain('别再联系')
  })

  it('拒联触点后来被人明确纠正过的，照常发', async () => {
    // 纠正（dnc_cleared）晚于那条拒联触点 → isDoNotContact 判否，
    // 这条要确认走通用判据后没有反而把已纠正的人也拦住。
    seed(db, {
      outcome: { contact_id: 'ct-1' },
      contact: { id: 'ct-1', do_not_contact: false },
      touchpoints: [
        {
          contact_id: 'ct-1',
          client_id: CLIENT,
          occurred_at: new Date(Date.now() - 60_000).toISOString(),
          metadata: { outcome: 'do_not_contact' },
        },
        {
          contact_id: 'ct-1',
          client_id: CLIENT,
          occurred_at: new Date().toISOString(),
          metadata: { outcome: 'dnc_cleared' },
        },
      ],
    })
    const w = makeWriter()
    const r = await sendApprovedOutcome(OUTCOME, deps(db, w))
    expect(w.sendSpy).toHaveBeenCalled()
    expect(r.message).not.toContain('别再联系')
  })

  it('只查这个联系人自己的触点——别的联系人、别的客户标了拒联不受牵连', async () => {
    // 干扰行：换 contact_id、换 client_id 各标一条拒联，任何一个过滤条件
    // 手滑被删掉，这条测试都会因为误判成「别再联系」而红。
    seed(db, {
      outcome: { contact_id: 'ct-1' },
      contact: { id: 'ct-1', do_not_contact: false },
      touchpoints: [
        {
          contact_id: 'ct-other',
          client_id: CLIENT,
          occurred_at: new Date().toISOString(),
          metadata: { outcome: 'do_not_contact' },
        },
        {
          contact_id: 'ct-1',
          client_id: 'other-client',
          occurred_at: new Date().toISOString(),
          metadata: { outcome: 'do_not_contact' },
        },
      ],
    })
    const w = makeWriter()
    const r = await sendApprovedOutcome(OUTCOME, deps(db, w))
    expect(w.sendSpy).toHaveBeenCalled()
    expect(r.message).not.toContain('别再联系')
  })

  it('查拒联记录时数据库出错——绝不能当成「没说过别联系」就放行发送', async () => {
    seed(db, { outcome: { contact_id: 'ct-1' }, contact: { id: 'ct-1', do_not_contact: false } })
    db.errorOn.contact_touchpoints = { message: '数据库连接超时' }
    const w = makeWriter()
    await expect(sendApprovedOutcome(OUTCOME, deps(db, w))).rejects.toThrow('触点')
    expect(w.sendSpy).not.toHaveBeenCalled()
  })

  it('超过平台时间窗口的不发，并说清早了几天', async () => {
    seed(db, { outcome: { occurred_at: new Date(Date.now() - 35 * 86_400_000).toISOString() } })
    const w = makeWriter()
    const r = await sendApprovedOutcome(OUTCOME, deps(db, w))
    expect(w.sendSpy).not.toHaveBeenCalled()
    expect(r.status).toBe('expired_no_send')
    expect(r.message).toContain('35 天')
  })

  it('组装不出来的不发（例如不认识的币种）', async () => {
    seed(db)
    const w = makeWriter({
      build: () => {
        throw new Error('不支持的币种 JPY')
      },
    })
    const r = await sendApprovedOutcome(OUTCOME, deps(db, w))
    expect(w.sendSpy).not.toHaveBeenCalled()
    expect(r.status).toBe('failed_permanent')
    expect(r.message).toContain('JPY')
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('Facebook 私信身份（PSID）匹配键 —— NAL 数据源', () => {
  it('DB 里的 page_scoped_user_id / facebook_page_id 原样递给 writer.build()，actionSource 按 source_kind 算', async () => {
    seed(db, {
      client: { facebook_page_id: '1177479655430100' },
      outcome: {
        contact_id: 'ct-1',
        customer_email: null,
        customer_phone: null,
        page_scoped_user_id: '28681838868174032',
        source_kind: 'messenger_conversation',
      },
      contact: { id: 'ct-1', do_not_contact: false },
    })
    const buildSpy = vi.fn().mockReturnValue({ data: [] })
    const w = makeWriter({ build: buildSpy })
    await sendApprovedOutcome(OUTCOME, deps(db, w))

    expect(buildSpy).toHaveBeenCalledTimes(1)
    const [outcomeArg, configArg] = buildSpy.mock.calls[0]
    expect(outcomeArg.pageScopedUserId).toBe('28681838868174032')
    expect(outcomeArg.actionSource).toBe('business_messaging')
    expect(configArg.facebookPageId).toBe('1177479655430100')
  })

  it('CTS 这类走邮箱/电话的记录，actionSource 仍是 email，PSID 恒为 null', async () => {
    seed(db) // 默认 source_kind: 'manual_seed'，走邮箱
    const buildSpy = vi.fn().mockReturnValue({ data: [] })
    const w = makeWriter({ build: buildSpy })
    await sendApprovedOutcome(OUTCOME, deps(db, w))

    const [outcomeArg] = buildSpy.mock.calls[0]
    expect(outcomeArg.actionSource).toBe('email')
    expect(outcomeArg.pageScopedUserId).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('试运行模式', () => {
  it('不真发，只存打码预览', async () => {
    seed(db, { client: { conversion_stage: 'dry_run' } })
    const w = makeWriter()
    const r = await sendApprovedOutcome(OUTCOME, deps(db, w))

    expect(w.sendSpy, '试运行绝不能真发').not.toHaveBeenCalled()
    expect(r.status).toBe('dry_run')
    expect(db.tables.me_conversion_writebacks[0].payload_preview).toBeTruthy()
  })

  it('顺带做只读预检，失败时如实说', async () => {
    seed(db, { client: { conversion_stage: 'dry_run' } })
    const w = makeWriter({ preflight: async () => ({ ok: false, detail: { token_valid: false } }) })
    const r = await sendApprovedOutcome(OUTCOME, deps(db, w))
    expect(r.message).toContain('预检没过')
  })

  it('客户没配 conversion_stage 时默认按试运行处理（不会误发）', async () => {
    seed(db, { client: { conversion_stage: null } })
    const w = makeWriter()
    await sendApprovedOutcome(OUTCOME, deps(db, w))
    expect(w.sendSpy).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('各种失败分档落到正确状态', () => {
  const cases: Array<[string, SendVerdict, string, boolean]> = [
    ['平台确认收到', { kind: 'accepted', receipt: {} }, 'confirmed', false],
    ['太旧', { kind: 'expired', detail: 'too old' }, 'expired_no_send', false],
    ['授权失效', { kind: 'auth', detail: '令牌失效' }, 'failed_permanent', false],
    ['限流可重试', { kind: 'retry', detail: '忙', retryAfterMs: 300_000 }, 'failed', false],
    ['结果不确定', { kind: 'in_doubt', detail: '超时' }, 'in_doubt', true],
    ['请求本身错', { kind: 'permanent', detail: '字段缺失' }, 'failed_permanent', false],
  ]

  it.each(cases)('%s → %s', async (_label, verdict, expected) => {
    db = new FakeDb()
    seed(db)
    const w = makeWriter({ accept: () => verdict })
    const r = await sendApprovedOutcome(OUTCOME, deps(db, w))
    expect(r.status).toBe(expected)
    expect(db.tables.me_conversion_writebacks[0].status).toBe(expected)
  })

  it('可重试的记下「大约多久后再试」', async () => {
    seed(db)
    const w = makeWriter({ accept: () => ({ kind: 'retry', detail: '忙', retryAfterMs: 300_000 }) })
    const r = await sendApprovedOutcome(OUTCOME, deps(db, w))
    expect(r.message).toContain('5 分钟')
    expect(db.tables.me_conversion_writebacks[0].next_attempt_at).toBeTruthy()
  })

  it('可重试的可以再点一次，且第二次真的会再发', async () => {
    seed(db)
    let call = 0
    const w = makeWriter({
      accept: () => (++call === 1 ? { kind: 'retry', detail: '忙' } : { kind: 'accepted', receipt: {} }),
    })
    const first = await sendApprovedOutcome(OUTCOME, deps(db, w))
    expect(first.status).toBe('failed')
    const second = await sendApprovedOutcome(OUTCOME, deps(db, w))
    expect(second.status).toBe('confirmed')
    expect(w.sendSpy).toHaveBeenCalledTimes(2)
  })

  it('授权失效的说人话，不甩错误码', async () => {
    seed(db)
    const w = makeWriter({ accept: () => ({ kind: 'auth', detail: 'OAuthException code 190' }) })
    const r = await sendApprovedOutcome(OUTCOME, deps(db, w))
    expect(r.message).toContain('重新连接')
    expect(r.message).not.toContain('190')
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('人工裁决「不确定」', () => {
  function seedDoubt() {
    db.tables.me_conversion_writebacks.push({
      id: 'wb-1', outcome_id: OUTCOME, destination: 'meta_capi', event_id: OUTCOME,
      status: 'in_doubt', attempts: 1, post_started_at: new Date().toISOString(),
    })
  }

  it('人核对到平台已收 → 记为已确认', async () => {
    seedDoubt()
    const r = await resolveDoubt('wb-1', 'confirmed', 'pm@example.com', db as never)
    expect(r.ok).toBe(true)
    expect(db.tables.me_conversion_writebacks[0].status).toBe('confirmed')
    // 要留痕是人工判定的，不能跟平台真回执混为一谈
    expect(db.tables.me_conversion_writebacks[0].receipt).toMatchObject({ manual: true })
  })

  it('人确认没收到 → 放回队列，并清掉发送标记', async () => {
    seedDoubt()
    const r = await resolveDoubt('wb-1', 'resend', 'pm@example.com', db as never)
    expect(r.ok).toBe(true)
    expect(db.tables.me_conversion_writebacks[0].status).toBe('queued')
    // 不清标记的话下一次会被自己的防重复闸挡住，永远发不出去
    expect(db.tables.me_conversion_writebacks[0].post_started_at).toBeNull()
  })

  it('放回队列后再点，真的会再发一次', async () => {
    seed(db)
    seedDoubt()
    await resolveDoubt('wb-1', 'resend', 'pm@example.com', db as never)
    const w = makeWriter()
    const r = await sendApprovedOutcome(OUTCOME, deps(db, w))
    expect(w.sendSpy).toHaveBeenCalledTimes(1)
    expect(r.status).toBe('confirmed')
  })

  it('🔴 只有「不确定」这一档能被人工裁决，别的状态一律不动', async () => {
    for (const status of ['confirmed', 'queued', 'sending', 'failed_permanent']) {
      db = new FakeDb()
      db.tables.me_conversion_writebacks.push({
        id: 'wb-1', outcome_id: OUTCOME, destination: 'meta_capi', event_id: OUTCOME,
        status, attempts: 1, post_started_at: null,
      })
      const r = await resolveDoubt('wb-1', 'confirmed', 'pm@example.com', db as never)
      expect(r.ok, `状态 ${status} 不该被人工裁决改动`).toBe(false)
      expect(db.tables.me_conversion_writebacks[0].status).toBe(status)
    }
  })
})
