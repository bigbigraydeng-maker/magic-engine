/**
 * 私信里的「别再联系」—— 挑得出来，而且**只提示、不封渠道**。
 *
 * 每一条 `it` 对应 `messenger-stop-signal.ts` 文件头里的一条纪律。
 * 判据宁可多报（提示而已），但下面这几种「别再提这个人」的收口必须成立，
 * 否则销售每天早上被同一个已经处理完的人骚扰一次，这条通道就会被无视。
 */

import { describe, expect, it } from 'vitest'
import {
  MAX_PER_CLIENT,
  pickStopSignals,
  looksLikeStopSignal,
  type InboundDm,
  type StopSignalInput,
} from '../messenger-stop-signal'
import type { DncTouch } from '../dnc'

const C = 'client-1'

function dm(over: Partial<InboundDm> = {}): InboundDm {
  return {
    clientId: C,
    contactId: 'p1',
    body: 'do not follow up',
    sentAt: '2026-08-10T00:00:00Z',
    ...over,
  }
}

function run(over: Partial<StopSignalInput> = {}) {
  return pickStopSignals({
    messages: [dm()],
    dnc: new Map(),
    lastHumanTouchAt: new Map(),
    ...over,
  })
}

describe('挑得出来', () => {
  it('客人说「do not follow up」→ 提示一条，带原话', () => {
    const { signals } = run()
    expect(signals).toHaveLength(1)
    expect(signals[0].contactId).toBe('p1')
    expect(signals[0].quote).toBe('do not follow up')
  })

  it('普通聊天不提示', () => {
    expect(run({ messages: [dm({ body: 'is the March tour still available?' })] }).signals).toEqual(
      [],
    )
  })

  it('空正文 / 只有空白不炸也不提示', () => {
    expect(run({ messages: [dm({ body: '' }), dm({ body: '   ' })] }).signals).toEqual([])
  })

  it('同一个人命中多条 → 只提示一次，取最新那句', () => {
    const { signals } = run({
      messages: [
        dm({ body: 'do not follow up', sentAt: '2026-08-01T00:00:00Z' }),
        dm({ body: '别再联系我', sentAt: '2026-08-09T00:00:00Z' }),
      ],
    })
    expect(signals).toHaveLength(1)
    expect(signals[0].quote).toBe('别再联系我')
  })

  it('原话太长要截断，不能把整页刷满', () => {
    const long = `do not follow up ${'x'.repeat(400)}`
    const q = run({ messages: [dm({ body: long })] }).signals[0].quote
    expect(q.length).toBeLessThanOrEqual(121)
    expect(q.endsWith('…')).toBe(true)
  })
})

describe('中文拒联候选只进入人工复核', () => {
  const positives = [
    '请不要再联系我',
    '不要再联系我',
    '客户说不要再联系了',
    '以后都不要联系了',
    '请把我从你们名单里删掉',
    '把我的资料删掉',
    '不要再发邮件给我',
    '请勿再来电',
    '不要再骚扰我',
    '拒绝任何联系',
    '不想再收到你们的信息',
    '客户明确要求退订',
  ]

  it.each(positives)('%s → 需要复核', (body) => {
    expect(looksLikeStopSignal(body)).toBe(true)
    expect(run({ messages: [dm({ body })] }).signals).toHaveLength(1)
  })

  it.each([
    '别再联系那家酒店，已经换了',
    '不需要联系保险，客户自己买了',
    '别再打给她老公了，打她本人',
  ])('%s → 不是自动 DNC，只能保持人工复核', (body) => {
    const { signals } = run({ messages: [dm({ body })] })
    // 旧判据可能高召回命中，但这条只产生 review signal，从不写永久 DNC。
    expect(signals).toHaveLength(1)
  })
})

/**
 * 🔴 这一组是这条通道能不能活下来的关键：**别天天提同一个已经处理过的人**。
 * 现有的 `dnc_maybe_wrong` 注释里写着同样的教训 —— FDE 被骚扰几次之后
 * 就会把整栏当噪音跳过，那时候真出事的那条也一起被跳过了。
 */
describe('已经处理过的人不再提', () => {
  const touches = (t: DncTouch[]) => new Map([['p1', { flag: false, touches: t }]])

  it('已经算拒联了 → 不提示（没什么可提醒的）', () => {
    expect(
      run({
        dnc: touches([{ outcome: 'do_not_contact', occurredAt: '2026-08-05T00:00:00Z' }]),
      }).signals,
    ).toEqual([])
  })

  it('镜像列写着拒联、触点没写 → 一样不提示（半写入状态也算）', () => {
    expect(run({ dnc: new Map([['p1', { flag: true, touches: [] }]]) }).signals).toEqual([])
  })

  /**
   * 🔴 人明确纠正过「判错了」→ 这个人**不算**拒联，所以要照常提示。
   * 判据只有一份（`isDoNotContact`），这里钉住我们真的走了那一份、
   * 没有自己拿 `outcome === 'do_not_contact'` 另判一次。
   */
  it('人纠正过「判错了」→ 他不算拒联，照常提示', () => {
    expect(
      run({
        dnc: touches([
          { outcome: 'do_not_contact', occurredAt: '2026-08-01T00:00:00Z' },
          { outcome: 'dnc_cleared', occurredAt: '2026-08-06T00:00:00Z' },
        ]),
      }).signals,
    ).toHaveLength(1)
  })

  it('私信之后有人手工记过一笔 → 有人看过了，不再提', () => {
    expect(
      run({ lastHumanTouchAt: new Map([['p1', '2026-08-11T00:00:00Z']]) }).signals,
    ).toEqual([])
  })

  it('手工记录在私信**之前** → 那是看私信之前记的，照常提示', () => {
    expect(
      run({ lastHumanTouchAt: new Map([['p1', '2026-08-01T00:00:00Z']]) }).signals,
    ).toHaveLength(1)
  })

  it('时间戳坏了不炸，也不会因此把人漏掉', () => {
    expect(run({ lastHumanTouchAt: new Map([['p1', 'not-a-date']]) }).signals).toHaveLength(1)
  })
})

describe('每客户上限', () => {
  const many = (n: number): InboundDm[] =>
    Array.from({ length: n }, (_, i) =>
      dm({ contactId: `p${i}`, sentAt: `2026-08-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z` }),
    )

  it(`一个客户最多 ${MAX_PER_CLIENT} 条，超出的算进 dropped（不许静默丢）`, () => {
    const { signals, dropped } = pickStopSignals({
      messages: many(MAX_PER_CLIENT + 7),
      dnc: new Map(),
      lastHumanTouchAt: new Map(),
    })
    expect(signals).toHaveLength(MAX_PER_CLIENT)
    expect(dropped).toBe(7)
  })

  it('被压掉的是最旧的那些 —— 新消息优先', () => {
    const { signals } = pickStopSignals({
      messages: [
        dm({ contactId: 'old', sentAt: '2026-08-01T00:00:00Z' }),
        dm({ contactId: 'new', sentAt: '2026-08-12T00:00:00Z' }),
      ],
      dnc: new Map(),
      lastHumanTouchAt: new Map(),
      maxPerClient: 1,
    })
    expect(signals.map((s) => s.contactId)).toEqual(['new'])
  })

  it('上限是**按客户**算的，一个大客户压不掉另一个客户的', () => {
    const { signals } = pickStopSignals({
      messages: [
        dm({ clientId: 'a', contactId: 'a1' }),
        dm({ clientId: 'a', contactId: 'a2' }),
        dm({ clientId: 'b', contactId: 'b1' }),
      ],
      dnc: new Map(),
      lastHumanTouchAt: new Map(),
      maxPerClient: 1,
    })
    expect(signals.map((s) => s.clientId).sort()).toEqual(['a', 'b'])
  })
})
