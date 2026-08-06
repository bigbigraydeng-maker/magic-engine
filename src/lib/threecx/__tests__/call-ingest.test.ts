/**
 * 把通话落进 CRM。钉住的四件事：
 *
 *   1. **客人打进来才建人** —— 未接来电必须建（那是「有人想订我们错过了」的
 *      唯一证据），纯外呼绝不建（打给供应商 / 打错号不配变成一张要跟的卡）
 *   2. **没接通的外呼不算「有人跟过他」** —— 不标的话销售早上看到一片灰卡、
 *      以为活做完了，而那些人一个电话都没接到
 *   3. **一通失败就停** —— 跳过失败的继续处理更新的，水位线会永久越过它，
 *      那几通电话再也不会进 CRM，而定时任务还记这次成功
 *   4. **永不抛异常** —— 一个客户挂掉不能让别的客户的电话也进不来
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))
vi.mock('@/lib/crm/identity', () => ({
  resolveContact: vi.fn(),
}))

import { supabaseAdmin } from '@/lib/supabase'
import { resolveContact } from '@/lib/crm/identity'
import { storeCalls, summariseCalls, THREECX_SOURCE } from '../call-ingest'
import type { PlannedCall } from '../call-plan'

const CLIENT = { clientId: 'cts', clientName: 'CTS Tours' }

const call = (over: Partial<PlannedCall> = {}): PlannedCall => ({
  id: 'call-1',
  occurredAt: '2026-08-06T02:00:00.000Z',
  direction: 'inbound',
  phone: '+6421363598',
  name: null,
  extension: '201',
  extensionName: 'Brett',
  answered: true,
  talkSeconds: 300,
  recordingRef: 'rec-9',
  countsAsReached: false,
  customerInitiated: true,
  ...over,
})

/** 落库的触点，测试里逐条检查。 */
let written: Record<string, unknown>[]
/** 已经存在的「号码 → 人」。 */
let knownPhones: Record<string, string>
/** 让第几条触点写失败（测「一通失败就停」）。 */
let failWriteFor: string | null

beforeEach(() => {
  // 调用记录也要清 —— 「不建人」那条断言的是 resolveContact 一次都没被叫，
  // 不清的话它会带着上一个用例的调用次数，测出来是假的。
  vi.clearAllMocks()
  written = []
  knownPhones = {}
  failWriteFor = null

  vi.mocked(resolveContact).mockImplementation(async ({ identities }) => {
    const phone = identities[0].value
    const existing = knownPhones[phone]
    if (existing) return { contactId: existing, created: false, merged: false } as never
    const id = `new-${phone}`
    knownPhones[phone] = id
    return { contactId: id, created: true, merged: false } as never
  })

  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table === 'contact_identities') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: (_col: string, value: string) => ({
                maybeSingle: async () => ({
                  data: knownPhones[value] ? { contact_id: knownPhones[value] } : null,
                }),
              }),
            }),
          }),
        }),
      } as never
    }
    if (table === 'contact_touchpoints') {
      return {
        upsert: (row: Record<string, unknown>) => ({
          select: () => ({
            maybeSingle: async () => {
              if (failWriteFor && row.source_ref === failWriteFor) {
                return { data: null, error: { message: '数据库炸了' } }
              }
              written.push(row)
              return { data: { id: `tp-${row.source_ref}` }, error: null }
            },
          }),
        }),
      } as never
    }
    throw new Error(`没预料到的表：${table}`)
  })
})

describe('谁能被建成一个人', () => {
  /** 这是电话这条线最值钱的一条：未接来电 = 有人想订、我们错过了。 */
  it('未接来电 → 建人', async () => {
    const r = await storeCalls(CLIENT, [
      call({ direction: 'inbound', answered: false, talkSeconds: 0, customerInitiated: true }),
    ])
    expect(r.newContacts).toBe(1)
    expect(r.touchpoints).toBe(1)
  })

  /** 打给供应商 / 同行 / 打错号，不配变成一张「今天该联系谁」的卡。 */
  it('纯外呼、号码对不上已有的人 → 不建人，如实报数', async () => {
    const r = await storeCalls(CLIENT, [call({ direction: 'outbound', customerInitiated: false })])
    expect(resolveContact).not.toHaveBeenCalled()
    expect(r.newContacts).toBe(0)
    expect(r.touchpoints).toBe(0)
    expect(r.unmatchedOutbound).toBe(1)
  })

  it('纯外呼、号码接得上已有的人 → 挂上去，照样记一笔', async () => {
    knownPhones['+6421363598'] = 'existing-1'
    const r = await storeCalls(CLIENT, [call({ direction: 'outbound', customerInitiated: false })])
    expect(r.newContacts).toBe(0)
    expect(r.touchpoints).toBe(1)
    expect(written[0].contact_id).toBe('existing-1')
  })
})

describe('算不算「有人跟过他」—— 判错会让人被埋掉', () => {
  /**
   * 读路径认的是 `metadata.automated`。名字像「机器发的」，但它真正回答的是
   * 「这一笔算不算有人跟过他」—— 拨过去没人接，客人那头什么都没收到。
   */
  it('没接通的外呼 → 标成「不算跟过」', async () => {
    knownPhones['+6421363598'] = 'existing-1'
    await storeCalls(CLIENT, [
      call({ direction: 'outbound', customerInitiated: false, answered: false, countsAsReached: false }),
    ])
    expect((written[0].metadata as Record<string, unknown>).automated).toBe(true)
  })

  it('真的聊过了 → 算跟过', async () => {
    knownPhones['+6421363598'] = 'existing-1'
    await storeCalls(CLIENT, [
      call({ direction: 'outbound', customerInitiated: false, countsAsReached: true }),
    ])
    expect((written[0].metadata as Record<string, unknown>).automated).toBe(false)
  })
})

describe('写下去的那条触点', () => {
  it('幂等键是话机的通话编号', async () => {
    await storeCalls(CLIENT, [call({ id: 'pbx-777' })])
    expect(written[0].source).toBe(THREECX_SOURCE)
    expect(written[0].source_ref).toBe('pbx-777')
  })

  it('摘要说人话，不是一串字段', async () => {
    await storeCalls(CLIENT, [call({ direction: 'inbound', answered: false, talkSeconds: 0 })])
    expect(written[0].summary).toBe('未接来电')
  })

  /** 录音是客人的通话内容 —— 只存编号，链接落库等于复制到没人管权限的地方。 */
  it('录音只存编号，绝不存链接', async () => {
    await storeCalls(CLIENT, [call({ recordingRef: 'rec-9' })])
    const meta = written[0].metadata as Record<string, unknown>
    expect(meta.recording_ref).toBe('rec-9')
    expect(JSON.stringify(meta)).not.toMatch(/https?:\/\//)
  })

  it('谁接的也记下来 —— 销售要分清昨天是不是自己跟的', async () => {
    await storeCalls(CLIENT, [call({ extension: '201', extensionName: 'Brett' })])
    const meta = written[0].metadata as Record<string, unknown>
    expect(meta.extension).toBe('201')
    expect(meta.extension_name).toBe('Brett')
  })
})

describe('一通失败就停，不许跳过去继续', () => {
  /**
   * 跳过失败的继续处理更新的，下一轮的水位线就会**永久越过**失败那条 ——
   * 那几通电话再也不会进 CRM，而定时任务还记这次成功。
   */
  it('中间那通写失败 → 就地停下，后面的一通都不落', async () => {
    failWriteFor = 'b'
    const r = await storeCalls(CLIENT, [
      call({ id: 'a', occurredAt: '2026-08-06T01:00:00.000Z' }),
      call({ id: 'b', occurredAt: '2026-08-06T02:00:00.000Z' }),
      call({ id: 'c', occurredAt: '2026-08-06T03:00:00.000Z' }),
    ])
    expect(written.map((w) => w.source_ref)).toEqual(['a'])
    expect(r.stoppedEarly).toContain('b')
  })

  /** 顺序必须从旧到新，否则「停在这里」停的是随机一条。 */
  it('传进来的顺序是乱的，也按时间从旧到新处理', async () => {
    await storeCalls(CLIENT, [
      call({ id: 'late', occurredAt: '2026-08-06T03:00:00.000Z' }),
      call({ id: 'early', occurredAt: '2026-08-06T01:00:00.000Z' }),
    ])
    expect(written.map((w) => w.source_ref)).toEqual(['early', 'late'])
  })

  it('永不抛异常 —— 一个客户挂掉不能让别人的电话也进不来', async () => {
    failWriteFor = 'a'
    await expect(storeCalls(CLIENT, [call({ id: 'a' })])).resolves.toBeTruthy()
  })
})

describe('小结说人话', () => {
  it('一串数字没人看得懂，这一句决定出问题时有没有人发现', () => {
    expect(
      summariseCalls({
        clientId: 'cts',
        clientName: 'CTS',
        calls: 12,
        newContacts: 3,
        touchpoints: 12,
        unmatchedOutbound: 2,
      }),
    ).toBe('12 通 · 新客人 3 · 记了 12 条 · 2 通打出去的对不上人')
  })

  it('中途停了要说出来', () => {
    const s = summariseCalls({
      clientId: 'cts', clientName: 'CTS', calls: 1, newContacts: 0,
      touchpoints: 1, unmatchedOutbound: 0, stoppedEarly: '通话 b 失败',
    })
    expect(s).toContain('中途停了')
  })

  it('整次失败就直说，不报一堆 0', () => {
    expect(
      summariseCalls({
        clientId: 'cts', clientName: 'CTS', calls: 0, newContacts: 0,
        touchpoints: 0, unmatchedOutbound: 0, error: '连不上落地库',
      }),
    ).toBe('没跑成：连不上落地库')
  })
})
