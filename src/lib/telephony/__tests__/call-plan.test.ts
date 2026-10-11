/**
 * 一通电话在 CRM 里意味着什么。
 *
 * 这里钉的每一条都对应一次真实代价：
 *   · 同事之间打分机变成客人 —— 客户 8/4 刚反馈过一次（换了个渠道重演）
 *   · 存下一个认不出来的号码 —— 将来销售照着它打给陌生人
 *   · 「拨过号」被算成「跟过了」—— 一片灰卡，人其实一个电话都没接到
 *   · 未接来电不进系统 —— 「有人想订而我们错过了」永远没人知道
 */

import { describe, expect, it } from 'vitest'
import {
  describeCall,
  formatDuration,
  planCallIngest,
  TRIVIAL_TALK_SECONDS,
  type CallRecord,
} from '../call-plan'

const call = (over: Partial<CallRecord> = {}): CallRecord => ({
  id: 'c1',
  startedAt: '2026-08-04T02:00:00Z',
  direction: 'inbound',
  counterpartyNumber: '021 363 598',
  counterpartyName: null,
  extension: '100',
  extensionName: 'Amy',
  answered: true,
  talkSeconds: 240,
  recordingRef: null,
  ...over,
})

const only = (records: CallRecord[]) => {
  const plan = planCallIngest(records)
  expect(plan.calls).toHaveLength(1)
  return plan.calls[0]
}

describe('内部通话 —— 整条丢', () => {
  /**
   * 客户 8/4 的原话：「contact 里面怎么还有工作人员」。
   * 那次是邮件，这次是分机 —— 不挡的话同一件事换个渠道重演。
   */
  it('同事之间打分机不进 CRM', () => {
    const plan = planCallIngest([call({ direction: 'internal' })])
    expect(plan.calls).toHaveLength(0)
    expect(plan.dropped[0]).toMatchObject({ why: '同事之间的内部通话', calls: 1 })
  })

  it('丢了几通说得出来 —— 判错了要能从这个数看出规模', () => {
    const plan = planCallIngest([
      call({ id: 'a', direction: 'internal' }),
      call({ id: 'b', direction: 'internal' }),
    ])
    expect(plan.dropped[0].calls).toBe(2)
  })
})

describe('号码 —— 认不出来就丢，绝不猜', () => {
  it.each(['Anonymous', 'withheld', 'Private Number', 'unavailable', '', '   ', null])(
    '没有能回拨的号码（%s）→ 丢',
    (counterpartyNumber) => {
      const plan = planCallIngest([call({ counterpartyNumber })])
      expect(plan.calls).toHaveLength(0)
      expect(plan.dropped[0].why).toBe('来电没有号码，回拨不了')
    },
  )

  /** 存一个错号码比不存更糟：将来销售照着它打过去，打给的是陌生人。 */
  it('规整不出 E.164 的脏号码 → 丢，并把原始值说出来', () => {
    const plan = planCallIngest([call({ counterpartyNumber: '123' })])
    expect(plan.calls).toHaveLength(0)
    expect(plan.dropped[0]).toMatchObject({ number: '123' })
    expect(plan.dropped[0].why).toContain('打给陌生人')
  })

  it.each([
    ['021 363 598', '+6421363598'],
    ['+64 21 363-598', '+6421363598'],
    ['0064213 63598', '+6421363598'],
  ])('本地写法 %s 规整成 %s —— 四个渠道才对得上', (raw, want) => {
    expect(only([call({ counterpartyNumber: raw })]).phone).toBe(want)
  })

  /** CTS 在 NZ、Oztop 在 AU —— 补哪个国码是调用方的事，不在这里写死。 */
  it('按客户市场补国码', () => {
    const plan = planCallIngest([call({ counterpartyNumber: '0412 345 678' })], {
      defaultCountry: 'AU',
    })
    expect(plan.calls[0].phone).toBe('+61412345678')
  })
})

describe('谁能被建成一个人', () => {
  /**
   * **这是这整件事最值钱的一条。** 客人打进来没人接 = 有人想订、我们错过了，
   * 而它今天在系统里完全不存在。判据等同于邮件那边的「客人自己开过口」。
   */
  it('未接来电 → 允许建人', () => {
    const c = only([call({ direction: 'inbound', answered: false, talkSeconds: 0 })])
    expect(c.customerInitiated).toBe(true)
  })

  it('接通的来电 → 允许建人', () => {
    expect(only([call({ direction: 'inbound' })]).customerInitiated).toBe(true)
  })

  /**
   * 我们主动打给供应商 / 同行 / 打错号 —— 这些不配变成一张「今天该联系谁」的卡。
   * 跟邮件那边同一条护栏。
   */
  it.each([true, false])('外呼（接通=%s）→ 不建人', (answered) => {
    const c = only([call({ direction: 'outbound', answered, talkSeconds: answered ? 300 : 0 })])
    expect(c.customerInitiated).toBe(false)
  })
})

describe('算不算「有人跟过他」—— 判错会让人被埋掉', () => {
  /**
   * automated-touch.ts 反复踩到的那个不对称：把「拨过号」算成「跟过了」，
   * 销售早上看到一片灰卡、以为活做完了，而那些人一个电话都没接到。
   */
  it('拨出去没人接 → 不算跟过', () => {
    expect(only([call({ direction: 'outbound', answered: false, talkSeconds: 0 })]).countsAsReached)
      .toBe(false)
  })

  it('拨错号、对方接起就挂 → 不算跟过', () => {
    const c = only([call({ direction: 'outbound', answered: true, talkSeconds: 3 })])
    expect(c.countsAsReached).toBe(false)
  })

  it('真的聊了 → 算跟过', () => {
    expect(only([call({ direction: 'outbound', talkSeconds: 300 })]).countsAsReached).toBe(true)
  })

  it(`边界就在 ${TRIVIAL_TALK_SECONDS} 秒上`, () => {
    const at = (talkSeconds: number) =>
      only([call({ direction: 'outbound', talkSeconds })]).countsAsReached
    expect(at(TRIVIAL_TALK_SECONDS - 1)).toBe(false)
    expect(at(TRIVIAL_TALK_SECONDS)).toBe(true)
  })

  /** 来电本来就不是我们在跟进 —— 这个标记对它没有意义，永远 false。 */
  it('来电永远不算「我们跟进了」，哪怕聊了半小时', () => {
    expect(only([call({ direction: 'inbound', talkSeconds: 1800 })]).countsAsReached).toBe(false)
  })
})

describe('转接 —— 一通电话只算一次', () => {
  /** 客人先到前台、再转给销售。逐段记的话，一通电话在时间线上会变成三次联系。 */
  const transferred = [
    call({ id: 'x', startedAt: '2026-08-04T02:00:00Z', extension: '100', extensionName: '前台', answered: true, talkSeconds: 20 }),
    call({ id: 'x', startedAt: '2026-08-04T02:00:25Z', extension: '201', extensionName: 'Brett', answered: true, talkSeconds: 300 }),
  ]

  it('合成一条', () => {
    expect(planCallIngest(transferred).calls).toHaveLength(1)
  })

  it('时长要加起来，不是取其中一段', () => {
    // 取最大值会白扔掉前台那 20 秒；取第一段会把一次 5 分钟通话记成 20 秒。
    expect(only(transferred).talkSeconds).toBe(320)
  })

  it('算在真正接起来的那个人头上，不是前台', () => {
    expect(only(transferred).extensionName).toBe('Brett')
  })

  it('时间取第一段 —— 客人是那个时候打进来的', () => {
    expect(only(transferred).occurredAt).toBe('2026-08-04T02:00:00Z')
  })

  it('录音在哪一段上都留得住', () => {
    const withRec = [transferred[0], { ...transferred[1], recordingRef: 'rec-9' }]
    expect(only(withRec).recordingRef).toBe('rec-9')
  })

  /**
   * **合并后必须重判。** 一通转接电话的第一段往往只有几秒（前台接起就转），
   * 照第一段的结论走，会把一次真的五分钟通话记成「没聊上」。
   */
  it('外呼转接：第一段几秒、总共聊了很久 → 算跟过', () => {
    const c = only([
      call({ id: 'y', direction: 'outbound', answered: true, talkSeconds: 4 }),
      call({ id: 'y', direction: 'outbound', answered: true, talkSeconds: 400, startedAt: '2026-08-04T02:00:05Z' }),
    ])
    expect(c.talkSeconds).toBe(404)
    expect(c.countsAsReached).toBe(true)
  })

  it('任何一段接通了，这通就是接通了', () => {
    const c = only([
      call({ id: 'z', answered: false, talkSeconds: 0 }),
      call({ id: 'z', answered: true, talkSeconds: 120, startedAt: '2026-08-04T02:00:10Z' }),
    ])
    expect(c.answered).toBe(true)
  })

  /** 幂等键是通话编号 —— 同一通重复读回来不会重复记。 */
  it('两条一模一样的记录不会变成两通', () => {
    expect(planCallIngest([call(), call()]).calls).toHaveLength(1)
  })
})

describe('时间线上显示成什么 —— 销售扫一眼就要知道发生了什么', () => {
  it.each([
    [{ direction: 'inbound' as const, answered: false, talkSeconds: 0 }, '未接来电'],
    [{ direction: 'inbound' as const, answered: true, talkSeconds: 252 }, '来电，通话 4 分 12 秒'],
    [{ direction: 'outbound' as const, answered: false, talkSeconds: 0 }, '拨出，没人接'],
    [{ direction: 'outbound' as const, answered: true, talkSeconds: 3 }, '拨出，接通几秒就断了'],
    [{ direction: 'outbound' as const, answered: true, talkSeconds: 300 }, '拨出，通话 5 分钟'],
  ])('%o → %s', (over, want) => {
    expect(describeCall(only([call(over)]))).toBe(want)
  })

  /** 接起来就挂的来电跟没接一样 —— 说成「通话 2 秒」会让人以为聊过。 */
  it('来电接起就挂 → 仍然说「未接来电」', () => {
    expect(describeCall(only([call({ direction: 'inbound', answered: true, talkSeconds: 2 })]))).toBe(
      '未接来电',
    )
  })

  it.each([
    [0, '0 秒'],
    [45, '45 秒'],
    [60, '1 分钟'],
    [61, '1 分 1 秒'],
    [3600, '60 分钟'],
  ])('%i 秒说成「%s」', (s, want) => {
    expect(formatDuration(s)).toBe(want)
  })
})
