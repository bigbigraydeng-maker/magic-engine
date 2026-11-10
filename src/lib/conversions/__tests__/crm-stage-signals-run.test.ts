/**
 * 线索阶段回传编排层（2026-11-10）。
 *
 * 假数据库按表存行，并真的执行 (client_id, source_kind, source_ref) 唯一约束——
 * 这一层唯一要紧的是「每天跑一次、跑两次、中途断了重跑，都不会多写多发」。
 * 发送口本身另有测试；这里只换掉它，看编排层交给它哪几条、交几次。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const sendMock = vi.fn()
vi.mock('../writeback-service', () => ({
  sendApprovedOutcome: (...a: unknown[]) => sendMock(...a),
}))

import { runCrmStageSignalsForClient, runCrmStageChunkForEnabledClients, CRM_STAGE_SOURCE_KIND } from '../crm-stage-signals-run'

type Row = Record<string, unknown>

class FakeDb {
  tables: Record<string, Row[]> = {
    clients: [],
    contacts: [],
    contact_touchpoints: [],
    contact_stage_events: [],
    me_sale_outcomes: [],
    me_conversion_writebacks: [],
    crm_bookings: [],
    crm_booking_milestones: [],
    crm_booking_events: [],
  }

  from(table: string) {
    const rows = this.tables[table]
    const all = this.tables
    const filters: Array<(r: Row) => boolean> = []
    let embedWritebacks = false
    let orderCol: string | null = null
    let patch: Row | null = null
    const q = {
      select(cols?: string) {
        embedWritebacks = typeof cols === 'string' && cols.includes('me_conversion_writebacks(')
        return q
      },
      eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return q },
      is(c: string, v: unknown) { filters.push((r) => (r[c] ?? null) === v); return q },
      in(c: string, v: unknown[]) { filters.push((r) => v.includes(r[c])); return q },
      gte(c: string, v: string) { filters.push((r) => String(r[c]) >= v); return q },
      order(c: string) { orderCol = c; return q },
      limit() { return q },
      update(p: Row) { patch = p; return q },
      filter(path: string, _op: string, v: string) {
        // 只支持本文件用到的 leads_config->crm_stage_signals->>enabled
        if (path === 'leads_config->crm_stage_signals->>enabled') {
          filters.push((r) => String((r.leads_config as { crm_stage_signals?: { enabled?: unknown } } | null)?.crm_stage_signals?.enabled) === v)
        }
        return q
      },
      async insert(row: Row) {
        if (table === 'me_sale_outcomes') {
          const dup = rows.some(
            (r) => r.client_id === row.client_id && r.source_kind === row.source_kind && r.source_ref === row.source_ref,
          )
          const dupContact =
            row.outcome_kind === 'lead_stage' &&
            rows.some(
              (r) =>
                r.outcome_kind === 'lead_stage' &&
                r.client_id === row.client_id &&
                r.contact_id === row.contact_id &&
                r.lead_stage === row.lead_stage,
            )
          if (dup || dupContact) return { data: null, error: { code: '23505', message: 'duplicate key' } }
        }
        rows.push({ id: `${table}-${rows.length + 1}`, redacted_at: null, ...row })
        return { data: null, error: null }
      },
      async maybeSingle() {
        return { data: rows.find((r) => filters.every((f) => f(r))) ?? null, error: null }
      },
      then(resolve: (v: { data: Row[]; error: null }) => unknown) {
        let out = rows.filter((r) => filters.every((f) => f(r)))
        if (patch) {
          for (const r of out) Object.assign(r, patch)
          return Promise.resolve(resolve({ data: out, error: null }))
        }
        if (orderCol) {
          const col = orderCol
          out = [...out].sort((a, b) => String(a[col]).localeCompare(String(b[col])))
        }
        if (embedWritebacks) {
          out = out.map((r) => ({ ...r, me_conversion_writebacks: all.me_conversion_writebacks.filter((w) => w.outcome_id === r.id) }))
        }
        return Promise.resolve(resolve({ data: out, error: null }))
      },
    }
    return q
  }
}

const CLIENT = 'client-x'
const DAY = 86_400_000
const NOW = new Date('2026-11-10T00:00:00Z')
const ago = (d: number) => new Date(NOW.getTime() - d * DAY).toISOString()
const LEAD = '1189338710082692'

const CONFIG = {
  crm_stage_signals: {
    enabled: true,
    mode: 'dry_run',
    dataset_id: '998877665544332',
    stages: [
      { event_name: 'Quoted', stage_keys: ['quoted'] },
      { event_name: 'Deposit Paid', stage_keys: ['deposit_paid'] },
    ],
  },
}

let db: FakeDb
function seedBasic(leadsConfig: unknown = CONFIG) {
  db.tables.clients.push({ id: CLIENT, default_phone_country: '64', leads_config: leadsConfig })
  db.tables.contacts.push({ id: 'c1', client_id: CLIENT, primary_email: 'A@Example.com', primary_phone: '021 555 123', do_not_contact: false })
  db.tables.contact_touchpoints.push({ client_id: CLIENT, contact_id: 'c1', source: 'meta_lead_form', source_ref: LEAD, occurred_at: ago(20) })
  db.tables.contact_stage_events.push({ client_id: CLIENT, contact_id: 'c1', to_stage: 'deposit_paid', created_at: ago(1) })
}

function run(maxSends?: number) {
  return runCrmStageSignalsForClient(
    CLIENT,
    { supabase: db as never, sendDeps: { writer: {} as never, fetcher: fetch }, now: NOW },
    maxSends ? { maxSends } : {},
  )
}

beforeEach(() => {
  db = new FakeDb()
  sendMock.mockReset()
  sendMock.mockImplementation(async (id: string) => {
    db.tables.me_conversion_writebacks.push({ outcome_id: id, status: 'dry_run' })
    return { status: 'dry_run', message: '', writebackId: 'wb' }
  })
})

describe('runCrmStageSignalsForClient', () => {
  it('客户没开 → 一条都不写、不发', async () => {
    seedBasic({})
    expect(await run()).toEqual({ ran: false, reason: 'not_enabled' })
    expect(db.tables.me_sale_outcomes).toHaveLength(0)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('配置写坏了 → 报「配置不对」，不是「没开」', async () => {
    seedBasic({ crm_stage_signals: { enabled: true, stages: 'x' } })
    expect(await run()).toEqual({ ran: false, reason: 'config_invalid' })
  })

  it('跳到已付定金 → 写两条（补上已报价）并按先后交给发送口', async () => {
    seedBasic()
    const s = await run()
    expect(s).toMatchObject({ ran: true, mode: 'dry_run', planned: 2, inserted: 2, remaining: 0 })
    const rows = db.tables.me_sale_outcomes
    expect(rows.map((r) => r.lead_stage)).toEqual(['Quoted', 'Deposit Paid'])
    expect(rows[0]).toMatchObject({
      outcome_kind: 'lead_stage',
      source_kind: CRM_STAGE_SOURCE_KIND,
      review_status: 'approved',
      meta_lead_id: LEAD,
      customer_email: 'a@example.com',
      customer_phone: '6421555123',
      source_ref: `${LEAD}:Quoted`,
    })
    expect(sendMock).toHaveBeenCalledTimes(2)
    // 发送不透传判断用的 now（发送口要用真实时间写尝试时刻）
    expect(sendMock.mock.calls[0][1]).not.toHaveProperty('now')
  })

  it('同一天跑第二次 → 不多写、已落定的不再交给发送口', async () => {
    seedBasic()
    await run()
    sendMock.mockClear()
    const s = await run()
    expect(s).toMatchObject({ ran: true, inserted: 0, alreadyExisted: 2 })
    expect(db.tables.me_sale_outcomes).toHaveLength(2)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('上次写进去了但没来得及发（中途断了）→ 这次补发', async () => {
    seedBasic()
    sendMock.mockImplementationOnce(async () => {
      throw new Error('网络断了')
    })
    await expect(run()).rejects.toThrow('网络断了')
    sendMock.mockClear()
    await run()
    expect(sendMock).toHaveBeenCalledTimes(2)
  })

  it('每次最多发 maxSends 条，剩下的报给流水线下一块接着发', async () => {
    seedBasic()
    const s = await run(1)
    expect(s).toMatchObject({ ran: true, remaining: 1 })
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('客人既没邮箱也没电话 → 不写（Meta 要至少一个客人信息，库里也有约束）', async () => {
    seedBasic()
    db.tables.contacts[0].primary_email = null
    db.tables.contacts[0].primary_phone = null
    const s = await run()
    expect(s).toMatchObject({ ran: true, inserted: 0, skippedNoMatchKey: 2 })
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('客人后来又填了一次表（新线索编号）→ 已报过的档不会挂到新编号上再报一次', async () => {
    seedBasic()
    await run()
    db.tables.contact_touchpoints.push({ client_id: CLIENT, contact_id: 'c1', source: 'meta_lead_form', source_ref: '2397056934398420', occurred_at: ago(1.5) })
    sendMock.mockClear()
    const s = await run()
    expect(s).toMatchObject({ ran: true, inserted: 0 })
    expect(db.tables.me_sale_outcomes).toHaveLength(2)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('已标「别再联系」的客人 → 不写入（不为发不出去的事再存一份邮箱电话）', async () => {
    seedBasic()
    db.tables.contacts[0].do_not_contact = true
    const s = await run()
    expect(s).toMatchObject({ ran: true, inserted: 0, skippedDoNotContact: 2 })
    expect(db.tables.me_sale_outcomes).toHaveLength(0)
  })

  it('发送口按触点查到拒联（没建发送记录）→ 记录标成「客人拒联」，以后不再被捞出来', async () => {
    seedBasic()
    sendMock.mockImplementation(async () => ({ status: 'redacted', message: '', writebackId: null }))
    await run()
    expect(db.tables.me_sale_outcomes.every((r) => r.review_status === 'rejected' && r.reject_reason === 'customer_opted_out')).toBe(true)
    sendMock.mockClear()
    expect(await run()).toMatchObject({ ran: true, attempted: 0, remaining: 0 })
  })

  it('发过但卡在「授权失效 / 平台忙」的不在这里反复撞（每条只尝试一次，归补发任务管）', async () => {
    seedBasic()
    sendMock.mockImplementation(async (id: string) => {
      db.tables.me_conversion_writebacks.push({ outcome_id: id, status: 'failed' })
      return { status: 'failed', message: '', writebackId: 'wb' }
    })
    await run()
    sendMock.mockClear()
    expect(await run()).toMatchObject({ ran: true, attempted: 0, remaining: 0 })
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('允许种类名单里没有线索阶段 → 一条都不写', async () => {
    seedBasic({ ...CONFIG, capi_send_kinds: ['purchase'] })
    expect(await run()).toEqual({ ran: false, reason: 'kind_not_allowed' })
    expect(db.tables.me_sale_outcomes).toHaveLength(0)
  })

  it('每块所有客户合计限量：名额用完还有客户没轮到 → done:false；下一块接着发，最后 done:true', async () => {
    seedBasic()
    db.tables.clients.push({ id: 'client-y', default_phone_country: '64', leads_config: CONFIG })
    db.tables.contacts.push({ id: 'c2', client_id: 'client-y', primary_email: 'b@example.com', primary_phone: null, do_not_contact: false })
    db.tables.contact_touchpoints.push({ client_id: 'client-y', contact_id: 'c2', source: 'meta_lead_form', source_ref: '2397056934398420', occurred_at: ago(9) })
    db.tables.contact_stage_events.push({ client_id: 'client-y', contact_id: 'c2', to_stage: 'quoted', created_at: ago(1) })
    const deps = { supabase: db as never, sendDeps: { writer: {} as never, fetcher: fetch }, now: NOW }
    const first = await runCrmStageChunkForEnabledClients(deps, 2)
    expect(first.done).toBe(false)
    expect(sendMock).toHaveBeenCalledTimes(2)
    const second = await runCrmStageChunkForEnabledClients(deps, 2)
    expect(second.done).toBe(true)
    expect(sendMock).toHaveBeenCalledTimes(3)
  })

  describe('某一档读订单里程碑', () => {
    const BOOKING_CONFIG = {
      crm_stage_signals: {
        ...CONFIG.crm_stage_signals,
        stages: [
          { event_name: 'Quoted', stage_keys: ['quoted'] },
          { event_name: 'Deposit Paid', booking_milestone: 'deposit' },
        ],
      },
    }
    function seedBooking(over: { status?: string; state?: string; markedDaysAgo?: number } = {}) {
      db.tables.clients.push({ id: CLIENT, default_phone_country: '64', leads_config: BOOKING_CONFIG })
      db.tables.contacts.push({ id: 'c1', client_id: CLIENT, primary_email: 'a@example.com', primary_phone: null, do_not_contact: false })
      db.tables.contact_touchpoints.push({ client_id: CLIENT, contact_id: 'c1', source: 'meta_lead_form', source_ref: LEAD, occurred_at: ago(20) })
      db.tables.crm_bookings.push({ id: 'b1', client_id: CLIENT, contact_id: 'c1', status: over.status ?? 'active' })
      db.tables.crm_booking_milestones.push({ booking_id: 'b1', client_id: CLIENT, kind: 'deposit', state: over.state ?? 'paid' })
      db.tables.crm_booking_events.push({
        client_id: CLIENT, booking_id: 'b1', action: 'milestone_paid', milestone_kind: 'deposit', created_at: ago(over.markedDaysAgo ?? 1),
      })
    }

    it('员工在订单里标了定金 → 报 Deposit Paid（并补 Quoted），时间是标的那一刻', async () => {
      seedBooking()
      const s = await run()
      expect(s).toMatchObject({ ran: true, planned: 2, inserted: 2 })
      expect(db.tables.me_sale_outcomes.map((r) => r.lead_stage)).toEqual(['Quoted', 'Deposit Paid'])
      expect(db.tables.me_sale_outcomes[1].occurred_at).toBe(ago(1))
    })

    it('客人阶段被改成「已付定金」但订单没标 → 不报定金', async () => {
      seedBooking({ state: 'unpaid' })
      db.tables.contact_stage_events.push({ client_id: CLIENT, contact_id: 'c1', to_stage: 'deposit_paid', created_at: ago(1) })
      const s = await run()
      expect(s).toMatchObject({ ran: true, inserted: 0 })
    })

    it('标了又取消（里程碑现在是未收）→ 不报', async () => {
      seedBooking({ state: 'unpaid' })
      expect(await run()).toMatchObject({ ran: true, planned: 0 })
    })

    it('订单已取消 → 不报', async () => {
      seedBooking({ status: 'cancelled' })
      expect(await run()).toMatchObject({ ran: true, planned: 0 })
    })

    it('标的时间在 7 天窗口之外 → 不报（补不回）', async () => {
      seedBooking({ markedDaysAgo: 9 })
      expect(await run()).toMatchObject({ ran: true, planned: 0 })
    })

    it('同一位客人两张订单：一张标了又取消、另一张后来真收了 → 时间按真收的那张算，不按取消的那张', async () => {
      seedBooking({ state: 'unpaid', markedDaysAgo: 3 })
      db.tables.crm_bookings.push({ id: 'b2', client_id: CLIENT, contact_id: 'c1', status: 'active' })
      db.tables.crm_booking_milestones.push({ booking_id: 'b2', client_id: CLIENT, kind: 'deposit', state: 'paid' })
      db.tables.crm_booking_events.push({ client_id: CLIENT, booking_id: 'b2', action: 'milestone_paid', milestone_kind: 'deposit', created_at: ago(1) })
      await run()
      const deposit = db.tables.me_sale_outcomes.find((r) => r.lead_stage === 'Deposit Paid')
      expect(deposit?.occurred_at).toBe(ago(1))
    })

    it('订单已取消、但客人这周刚被报价 → 只报 Quoted，不报定金', async () => {
      seedBooking({ status: 'cancelled' })
      db.tables.contact_stage_events.push({ client_id: CLIENT, contact_id: 'c1', to_stage: 'quoted', created_at: ago(2) })
      await run()
      expect(db.tables.me_sale_outcomes.map((r) => r.lead_stage)).toEqual(['Quoted'])
    })

    it('别的客户的订单不会被读进来', async () => {
      seedBooking({ state: 'unpaid' })
      db.tables.crm_bookings.push({ id: 'b9', client_id: 'other', contact_id: 'c1', status: 'active' })
      db.tables.crm_booking_milestones.push({ booking_id: 'b9', client_id: 'other', kind: 'deposit', state: 'paid' })
      db.tables.crm_booking_events.push({ client_id: 'other', booking_id: 'b9', action: 'milestone_paid', milestone_kind: 'deposit', created_at: ago(1) })
      expect(await run()).toMatchObject({ ran: true, planned: 0 })
    })
  })

  it('别的客户的阶段变化不会被读进来', async () => {
    seedBasic()
    db.tables.contact_stage_events.push({ client_id: 'other', contact_id: 'c1', to_stage: 'quoted', created_at: ago(1) })
    db.tables.contact_touchpoints.push({ client_id: 'other', contact_id: 'c1', source: 'meta_lead_form', source_ref: '2397056934398420', occurred_at: ago(3) })
    await run()
    expect(db.tables.me_sale_outcomes.every((r) => r.client_id === CLIENT && r.meta_lead_id === LEAD)).toBe(true)
  })
})
