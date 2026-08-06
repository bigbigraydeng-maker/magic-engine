/**
 * 今天这份名单，一天之内不许在人眼皮底下变。
 *
 * PM 2026-08-05：「每次点卡片，做了动作后回到目录页，我如何知道哪个已经
 * 联系了？当前的设计无法做成工作流水线。」
 *
 * 这里钉的是那条规则的两半 —— **两半都成立才叫流水线**：
 *   · 我们今天做的动作，绝不移动任何人（否则脚下的地面在动）
 *   · 客人今天做的动作，照常实时进来（否则今天最热的线索要等到明天）
 */

import { describe, expect, it } from 'vitest'
import { dayProgress, dayRow, localDayStartMs, withoutOurActionsSince } from '../day-list'
import type { ContactLike, TouchpointLike } from '../segments'

const NOW = new Date('2026-08-05T04:00:00.000Z') // 新西兰 8/5 下午 4 点
/** 新西兰 8/5 零点 = UTC 8/4 12:00（UTC+12）。 */
const DAY_START = new Date('2026-08-04T12:00:00.000Z').getTime()

const tp = (over: Partial<TouchpointLike> & { direction: 'inbound' | 'outbound' }): TouchpointLike => ({
  channel: 'email',
  occurredAt: '2026-08-05T02:00:00.000Z',
  ...over,
})

const person = (touchpoints: TouchpointLike[], over: Partial<ContactLike> = {}): ContactLike => ({
  id: 'c1',
  displayName: 'Susan',
  doNotContact: false,
  hasPhone: true,
  touchpoints,
  ...over,
})

/** 昨天进的线，今天还没人碰过 —— 典型的「新客人，还没打过」。 */
const YESTERDAY_LEAD = [tp({ direction: 'inbound', occurredAt: '2026-08-04T02:00:00.000Z' })]

const row = (c: ContactLike, touchedToday = false) =>
  dayRow(c, NOW, { dayStartMs: DAY_START, touchedToday })

describe('我们今天做的动作，绝不移动任何人', () => {
  /**
   * **这是这次要修的那个 bug。** 原先一记录「联系过了」，`lastOutbound`
   * 从 0 变成非 0，这个人当场不属于「新客人，还没打过」了 —— 于是他不是
   * 变灰，是换了位置或者干脆消失，那张灰卡根本没机会留在原地给人看。
   */
  it('今天打过电话之后，他还留在原来那一批', () => {
    const before = row(person(YESTERDAY_LEAD)).seg.segment
    const after = row(
      person([...YESTERDAY_LEAD, tp({ direction: 'outbound', occurredAt: '2026-08-05T03:00:00.000Z' })]),
      true,
    ).seg.segment

    expect(before).toBe('new_untouched')
    expect(after).toBe('new_untouched')
  })

  it('留在原地，同时标成已处理 —— 看得见自己推到哪了', () => {
    const r = row(
      person([...YESTERDAY_LEAD, tp({ direction: 'outbound', occurredAt: '2026-08-05T03:00:00.000Z' })]),
      true,
    )
    expect(r.handled).toBe(true)
    expect(r.handledWhy).toBe('今天联系过了')
  })

  /** 昨天联系过的人，今天本来就该按「联系过之后」的样子分 —— 不能一起冻住。 */
  it('昨天的动作照常算数，只冻结今天的', () => {
    const r = row(
      person([
        tp({ direction: 'inbound', occurredAt: '2026-08-01T02:00:00.000Z' }),
        tp({ direction: 'outbound', occurredAt: '2026-08-02T02:00:00.000Z', outcome: 'no_answer' }),
      ]),
    )
    expect(r.seg.segment).not.toBe('new_untouched')
    expect(r.handled).toBe(false)
  })
})

describe('客人今天做的动作，照常实时进来', () => {
  /**
   * 今天进线的客人**必须当天出现**。冻结如果连入站一起冻，
   * 今天最热的那批线索要等到明天才进名单 —— 而线索会凉。
   */
  it('今天刚进线的新客人，当天就在名单上', () => {
    const r = row(person([tp({ direction: 'inbound', occurredAt: '2026-08-05T01:00:00.000Z' })]))
    expect(r.seg.segment).toBe('new_untouched')
    expect(r.handled).toBe(false)
  })

  /**
   * 冻结只摘我们的动作，**不摘客人的**。
   *
   * 连入站一起摘的话，这个人在冻结版里就变成「一条记录都没有」——
   * 「最后来往时间」退回时间原点，卡片上会写出「进线 43800 小时还没人联系」
   * 那种荒唐话（这套系统真的出过这个 bug）。
   *
   * 用 `lastTouchAt` 钉这一条，不用文案：文案会改，而「他最后一次跟我们
   * 有来往是什么时候」是事实，改不了。
   */
  it('冻结之后，「最后来往时间」仍然是客人真实来信的时间', () => {
    const at = '2026-08-05T01:00:00.000Z'
    const r = row(person([tp({ direction: 'inbound', occurredAt: at })]))
    expect(r.seg.lastTouchAt).toBe(at)
  })

  /**
   * **只增不减，但可以变得更紧急。** 早上发了邮件、中午他回了话 ——
   * 这是当天最该被看见的一件事，压在「新客人」那一批里等到明天就凉了。
   */
  it('今天联系过、客人今天又回了话 → 升到「客户回话了」', () => {
    const r = row(
      person([
        ...YESTERDAY_LEAD,
        tp({ direction: 'outbound', occurredAt: '2026-08-05T01:00:00.000Z' }),
        tp({ direction: 'inbound', occurredAt: '2026-08-05T03:00:00.000Z' }),
      ]),
      true,
    )
    expect(r.seg.segment).toBe('replied')
  })

  /** 打开 / 点击是客人做的，不是我们做的 —— 冻结时不该被摘掉。 */
  it('今天的点击信号不会被当成「我们的动作」摘掉', () => {
    const clicked = person([
      tp({ direction: 'inbound', occurredAt: '2026-07-20T02:00:00.000Z' }),
      tp({ direction: 'outbound', occurredAt: '2026-07-21T02:00:00.000Z' }),
      tp({ direction: 'outbound', occurredAt: '2026-08-05T01:00:00.000Z', engagement: 'click' }),
    ])
    expect(row(clicked).seg.segment).toBe('clicked_link')
  })
})

/**
 * 直接钉「摘掉哪些」这条规则本身。
 *
 * 上面那些用例走的是完整的分批结果，而「取更紧急的那一个」会把很多差别
 * 盖掉 —— 摘错了照样能得出对的桶。规则本身必须单独钉住，否则它哪天被改坏了
 * 没有任何测试会响。
 */
describe('到底摘掉哪些触点', () => {
  const mixed = person([
    tp({ direction: 'inbound', occurredAt: '2026-08-05T01:00:00.000Z' }),   // 今天客人来的
    tp({ direction: 'outbound', occurredAt: '2026-08-05T02:00:00.000Z' }),  // 今天我们发的 ← 只摘这个
    tp({ direction: 'outbound', occurredAt: '2026-08-05T03:00:00.000Z', engagement: 'click' }), // 今天客人点的
    tp({ direction: 'outbound', occurredAt: '2026-08-03T02:00:00.000Z' }),  // 前天我们发的
  ])

  it('只摘「今天我们发出的真人动作」，其余一个不动', () => {
    const kept = withoutOurActionsSince(mixed, DAY_START).touchpoints
    expect(kept).toHaveLength(3)
    expect(kept.map((t) => t.occurredAt)).toEqual([
      '2026-08-05T01:00:00.000Z',
      '2026-08-05T03:00:00.000Z',
      '2026-08-03T02:00:00.000Z',
    ])
  })

  /** 时间读不出来的不敢摘 —— 摘错会让一个已经跟过的人重新冒出来当新客人。 */
  it('时间坏掉的触点留着，不猜', () => {
    const broken = person([tp({ direction: 'outbound', occurredAt: '不是时间' })])
    expect(withoutOurActionsSince(broken, DAY_START).touchpoints).toHaveLength(1)
  })

  it('不改原来那个对象 —— 实时版还要用它', () => {
    const before = mixed.touchpoints.length
    withoutOurActionsSince(mixed, DAY_START)
    expect(mixed.touchpoints).toHaveLength(before)
  })
})

describe('不写触点的那几个出口，也要看得出已经处理过', () => {
  /**
   * **推迟和「他不买了」不写触点** —— 推迟改的是 `snooze_until`，
   * 「分错了」写的是反馈表。它们以前靠「这个人从名单上消失」当反馈；
   * 名单一冻结，他们会留在原地**并且看起来没被处理过**，那比改之前更糟。
   */
  it('推迟之后：留在原地，但标成已处理并说清是怎么处理的', () => {
    const r = row(person(YESTERDAY_LEAD, { snoozeUntil: '2026-08-12T00:00:00.000Z' }))
    expect(r.handled).toBe(true)
    expect(r.handledWhy).toBeTruthy()
    expect(r.handledWhy).not.toBe('今天联系过了')
  })

  it('阶段推到成交 / 停止营销之后，同样标成已处理', () => {
    const r = row(person(YESTERDAY_LEAD, { stageSuppressed: true, stageLabel: '已成交' }))
    expect(r.handled).toBe(true)
  })

  it('什么都没做过的人，不会被误标成已处理', () => {
    const r = row(person(YESTERDAY_LEAD))
    expect(r.handled).toBe(false)
    expect(r.handledWhy).toBeNull()
  })
})

describe('顶上那条进度', () => {
  it('三个数对得上', () => {
    const p = dayProgress([
      { handled: true },
      { handled: true },
      { handled: false },
      { handled: false },
      { handled: false },
    ])
    expect(p).toEqual({ total: 5, done: 2, left: 3 })
  })

  it('一个都没处理 / 全处理完了', () => {
    expect(dayProgress([{ handled: false }])).toEqual({ total: 1, done: 0, left: 1 })
    expect(dayProgress([{ handled: true }])).toEqual({ total: 1, done: 1, left: 0 })
    expect(dayProgress([])).toEqual({ total: 0, done: 0, left: 0 })
  })
})

/**
 * 「今天从几点开始」必须按客户所在地算。
 *
 * 服务器跑在世界标准时间，比新西兰晚 12 小时。直接用服务器的日子，
 * **每天中午名单就翻篇了** —— 上午做完的一批会突然全部变回「没处理」。
 * 这套系统在「今天已跟过」那个数字上已经踩过一次同样的坑。
 */
describe('今天从几点开始', () => {
  it('新西兰：UTC 中午之后就是新的一天了', () => {
    // UTC 8/5 04:00 = 新西兰 8/5 16:00 → 今天从 UTC 8/4 12:00 开始
    expect(localDayStartMs(new Date('2026-08-05T04:00:00.000Z'), 'Pacific/Auckland')).toBe(
      Date.parse('2026-08-04T12:00:00.000Z'),
    )
  })

  it('新西兰：UTC 中午之前还算前一天', () => {
    // UTC 8/5 11:00 = 新西兰 8/5 23:00 → 还是同一个「今天」
    expect(localDayStartMs(new Date('2026-08-05T11:00:00.000Z'), 'Pacific/Auckland')).toBe(
      Date.parse('2026-08-04T12:00:00.000Z'),
    )
  })

  /** 跨过新西兰的午夜之后，才算新的一天。 */
  it('新西兰午夜一过，换成新的一天', () => {
    expect(localDayStartMs(new Date('2026-08-05T12:30:00.000Z'), 'Pacific/Auckland')).toBe(
      Date.parse('2026-08-05T12:00:00.000Z'),
    )
  })

  it('澳洲客户按澳洲算（跟新西兰差两小时）', () => {
    const nz = localDayStartMs(new Date('2026-08-05T04:00:00.000Z'), 'Pacific/Auckland')
    const au = localDayStartMs(new Date('2026-08-05T04:00:00.000Z'), 'Australia/Sydney')
    expect(au - nz).toBe(2 * 3600_000)
  })

  /** 夏令时会让偏移量变 —— 不能写死 +12。 */
  it('夏令时期间偏移量跟着变，不写死', () => {
    const winter = localDayStartMs(new Date('2026-08-05T04:00:00.000Z'), 'Pacific/Auckland')
    const summer = localDayStartMs(new Date('2026-01-15T04:00:00.000Z'), 'Pacific/Auckland')
    // 8 月是 UTC+12，1 月是 UTC+13 —— 当天零点对应的 UTC 时刻要差一小时
    expect(new Date(winter).getUTCHours()).toBe(12)
    expect(new Date(summer).getUTCHours()).toBe(11)
  })

  it('时区字符串坏了也不炸，退回 UTC 当天零点', () => {
    expect(localDayStartMs(new Date('2026-08-05T04:00:00.000Z'), '不是时区')).toBe(
      Date.parse('2026-08-05T00:00:00.000Z'),
    )
  })
})
