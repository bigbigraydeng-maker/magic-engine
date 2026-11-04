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
import { dayProgress, dayRow, dayWorklist, localDayStartMs, withoutOurActionsSince } from '../day-list'
import type { ContactLike, IndustryPlaybook, TouchpointLike } from '../segments'

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
    // 「他还没回」是算出来的事实，不是客套话 —— handled 只在「我们出手之后
    // 他确实没再动过」时为真。销售真正想知道的正是这半句（板桥）。
    expect(r.handledWhy).toBe('今天联系过了，他还没回')
    expect(r.handledKind).toBe('followed')
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

  /**
   * **换季那两天**（Codex 复审 2026-08-15 给的精确复现）。
   *
   * 偏移量必须在「当地午夜那一刻」取。原先在 `asUtc` 那一刻取 —— 那是当地
   * **中午**附近，平时看不出差别，换季那天差一小时：
   *
   *   · 秋季（4/5，+13 → +12）：真实零点 04-04T11:00Z，取错会算成 12:00Z
   *     → 当地 00:00–01:00 做的动作不算「今天」，那一小时的卡片不变灰
   *   · 春季（9/27，+12 → +13）：取错会把前一天最后一小时算进今天
   *
   * 一年只错两天，但错的那天是**整整一小时的动作凭空不算数** ——
   * 而这一页的全部价值就是「我做过的事看得见」。
   */
  it('秋季换季日：按当地午夜的偏移算，不按中午的', () => {
    // 奥克兰 2026-04-05 当地零点仍在夏令时（+13）→ 04-04T11:00Z
    expect(localDayStartMs(new Date('2026-04-05T04:00:00.000Z'), 'Pacific/Auckland')).toBe(
      Date.parse('2026-04-04T11:00:00.000Z'),
    )
  })

  it('春季换季日：同样按当地午夜算', () => {
    // 奥克兰 2026-09-27 当地零点还是标准时（+12）→ 09-26T12:00Z
    expect(localDayStartMs(new Date('2026-09-27T04:00:00.000Z'), 'Pacific/Auckland')).toBe(
      Date.parse('2026-09-26T12:00:00.000Z'),
    )
  })

  it('时区字符串坏了也不炸，退回 UTC 当天零点', () => {
    expect(localDayStartMs(new Date('2026-08-05T04:00:00.000Z'), '不是时区')).toBe(
      Date.parse('2026-08-05T00:00:00.000Z'),
    )
  })
})

/**
 * `dayWorklist` —— **路由唯一调用的那个函数**。
 *
 * 子牙 2026-08-06 复审抓到：它零测试覆盖，而上一版六处变异全落在 `dayRow` 和
 * `withoutOurActionsSince` 上，恰好绕开了唯一进生产的这个。后果是两个 BLOCKER：
 *
 *   · 推迟 / 成交的人被冷热过滤整个筛掉 —— **照旧凭空消失**，
 *     而文件头注释、路由注释、一条测试名三处都声称修好了
 *   · 今天标「不买了」的人留在原桶，**邮箱还在群发地址里**
 *
 * 「测试绿」和「功能对」是两件事，中间隔着「测的是不是真正跑的那条路」。
 */
describe('真正进生产的那个函数', () => {
  const list = (c: ContactLike, touched = false) =>
    dayWorklist([c], NOW, { dayStartMs: DAY_START, touchedToday: () => touched })

  it('普通待办：在名单上', () => {
    expect(list(person(YESTERDAY_LEAD))).toHaveLength(1)
  })

  /**
   * **原 M2.7a 缺口，2026-08-15 修好。** 这四条钉的是那个修法的两个方向 ——
   * 两个方向都必须成立，只做一半就是把 bug 从一头搬到另一头。
   *
   * 「推迟」和「推到成交」改的是 contact 上的字段（`snooze_until` / `stage`），
   * 不是触点。只摘触点的话，冻结副本原样带着它们，两个版本双双「已排除」
   * → 被 `onList` 过滤掉 → **人点完就消失**，正是这套冻结机制要修的毛病。
   *
   * 修法读的是两条本来就在库里的时间证据：那一笔 `action==='snooze'` 的出站
   * 触点、以及 `contacts.stage_updated_at`。
   */
  const SNOOZE_TODAY = tp({
    direction: 'outbound',
    occurredAt: '2026-08-05T03:00:00.000Z',
    action: 'snooze',
  })

  it.each([
    ['推迟', { snoozeUntil: '2026-08-12T00:00:00.000Z' }, [SNOOZE_TODAY]],
    [
      '推到成交',
      { stageSuppressed: true, stageLabel: '已成交', stageSuppressedToday: true },
      [],
    ],
  ])('今天%s：留在名单上，不消失', (_label, over, extra) => {
    expect(list(person([...YESTERDAY_LEAD, ...extra], over))).toHaveLength(1)
  })

  /**
   * 另一个方向：**只清今天弄下去的**。
   *
   * 昨天推迟 / 昨天成交的人今天本来就不该在名单上 —— 一并清掉的话，
   * 所有推迟过的人会在第二天全部冒回来，销售每天早上都要重新推一遍，
   * 「推迟」这个按钮当场作废。
   */
  it.each([
    ['推迟', { snoozeUntil: '2026-08-12T00:00:00.000Z' }, []],
    [
      '推到成交',
      { stageSuppressed: true, stageLabel: '已成交', stageSuppressedToday: false },
      [],
    ],
  ])('昨天%s 的人，今天照旧不在名单上', (_label, over, extra) => {
    expect(list(person([...YESTERDAY_LEAD, ...extra], over))).toHaveLength(0)
  })

  /**
   * 🔴 **已经不在名单上的人，今天在两个「不再联系」的阶段之间挪动，不许冒回来**
   * （Codex 复审 2026-08-15 第二轮）。
   *
   * CTS 的「付了定金」「付清了」「快出行了」都是不进名单的阶段。一位已付定金的
   * 客人今天被推到「付清了」—— 如果只凭「今天改过阶段」就清掉抑制，冻结版会按
   * 历史触点把他判成 warm，**塞进今天要联系的名单**：一个已经付清全款的客人
   * 跳出来让销售去推销他。
   *
   * 所以判据是「改**之前**那个阶段抑不抑制」（读路径按 `from_stage` 算），
   * 不是「今天改过没有」。这里 `stageSuppressedToday: false` 代表的正是
   * 「他今天早上本来就不在名单上」。
   */
  it('已成交的人今天改到另一个成交阶段：不许被塞回名单', () => {
    expect(
      list(
        person(YESTERDAY_LEAD, {
          stageSuppressed: true,
          stageLabel: '付清了',
          // 改之前是「付了定金」—— 同样不在名单上
          stageSuppressedToday: false,
        }),
      ),
    ).toHaveLength(0)
  })

  /**
   * 认的必须是**推迟这个按钮**，不能是「今天有任何出站」。
   *
   * （变异验证抓出来的漏洞：把判据放宽成「今天有出站」时，上面那些用例
   * 一条都没红。）差别在这里 —— 一个推迟到下个月的客人，今天只要有人给他
   * 记了一笔普通笔记（补记一通旧电话、群发扫到他），冻结副本上的推迟就被
   * 清掉，他**当天重新冒回名单**，销售照着打过去。推迟这个按钮等于白按。
   */
  it('推迟到下个月的人，今天记了一笔普通笔记 —— 照旧不在名单上', () => {
    const ordinaryNoteToday = tp({
      direction: 'outbound',
      occurredAt: '2026-08-05T03:00:00.000Z',
    })
    expect(
      list(person([...YESTERDAY_LEAD, ordinaryNoteToday], { snoozeUntil: '2026-09-12T00:00:00.000Z' })),
    ).toHaveLength(0)
  })

  /** 留在名单上还不够 —— 必须是**灰的**，并且说清是怎么处理的。 */
  it('今天推迟：留在原地变灰，理由说的是那个动作', () => {
    const r = row(
      person([...YESTERDAY_LEAD, SNOOZE_TODAY], { snoozeUntil: '2026-08-12T00:00:00.000Z' }),
      true,
    )
    expect(r.onList).toBe(true)
    expect(r.handled).toBe(true)
    expect(r.handledKind).toBe('closed')
  })

  /**
   * **BLOCKER B1 —— 这条是会真发出去的。**
   *
   * 「他不买了」的结论写在今天的出站触点上，冻结版看不见它。上一版因此把人
   * 留在原来那个「该发邮件」的桶里，群发地址照抄整桶 —— 一个今天亲口说不买的
   * 客人当天会收到一封面向他的群发信，CRM 里还记一笔我们发过。
   */
  it('今天标了「不买了」：留在名单上、算已处理，理由说的是那个动作不是「联系过了」', () => {
    const rows = list(
      person([
        ...YESTERDAY_LEAD,
        tp({ direction: 'outbound', occurredAt: '2026-08-05T03:00:00.000Z', outcome: 'not_interested' }),
      ]),
      true,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].handled).toBe(true)
    // 措辞跟按钮上那句一模一样 —— 销售不用在脑子里翻译一次（板桥）
    expect(rows[0].handledWhy).toContain('他说不买了')
  })

  it('今天标了「号码是坏的」：同样算已处理', () => {
    const rows = list(
      person([
        ...YESTERDAY_LEAD,
        tp({ direction: 'outbound', occurredAt: '2026-08-05T03:00:00.000Z', outcome: 'bad_number' }),
      ]),
      true,
    )
    expect(rows[0].handled).toBe(true)
  })

  /** 昨天就已经拒绝的人，今天压根不该上名单 —— 「留在原地」只针对今天处理的。 */
  it('昨天就拒绝了的人，今天不上名单', () => {
    const rows = list(
      person([
        tp({ direction: 'inbound', occurredAt: '2026-08-01T02:00:00.000Z' }),
        tp({ direction: 'outbound', occurredAt: '2026-08-02T02:00:00.000Z', outcome: 'not_interested' }),
      ]),
    )
    expect(rows).toHaveLength(0)
  })

  /** 「先放着」那一层（cold）本来就不进今天的名单。 */
  it('客户说了以后才走 → 不在今天的名单上', () => {
    const rows = list(
      person([
        tp({ direction: 'inbound', occurredAt: '2026-08-01T02:00:00.000Z' }),
        tp({ direction: 'outbound', occurredAt: '2026-08-02T02:00:00.000Z', travelWindow: '明年三月' }),
      ]),
    )
    expect(rows).toHaveLength(0)
  })

  /** `touchedToday` 得真的接到 `handled` 上 —— 上一版把它硬写成 false，测试一个不响。 */
  it('touchedToday 真的接通了', () => {
    expect(list(person(YESTERDAY_LEAD), false)[0].handled).toBe(false)
    expect(list(person(YESTERDAY_LEAD), true)[0].handled).toBe(true)
  })

  it('每个人各自判自己的 touchedToday，不是一刀切', () => {
    const a = { ...person(YESTERDAY_LEAD), id: 'a' }
    const b = { ...person(YESTERDAY_LEAD), id: 'b' }
    const rows = dayWorklist([a, b], NOW, {
      dayStartMs: DAY_START,
      touchedToday: (id) => id === 'a',
    })
    expect(rows.find((r) => r.id === 'a')!.handled).toBe(true)
    expect(rows.find((r) => r.id === 'b')!.handled).toBe(false)
  })

  /** 排序必须跟旧名单一致 —— 位置正是销售用来记「我推到哪了」的东西。 */
  it('更紧急的排前面', () => {
    const replied = {
      ...person([
        tp({ direction: 'inbound', occurredAt: '2026-08-01T02:00:00.000Z' }),
        tp({ direction: 'outbound', occurredAt: '2026-08-02T02:00:00.000Z' }),
        tp({ direction: 'inbound', occurredAt: '2026-08-03T02:00:00.000Z' }),
      ]),
      id: 'replied',
    }
    const fresh = { ...person(YESTERDAY_LEAD), id: 'fresh' }
    const rows = dayWorklist([fresh, replied], NOW, {
      dayStartMs: DAY_START,
      touchedToday: () => false,
    })
    expect(rows.map((r) => r.id)).toEqual(['replied', 'fresh'])
  })
})

/**
 * 🔴 **升级过的人绝不能算「已处理」。**（子牙 2026-08-06 复审 R2）
 *
 * `touchedToday` 只问「我们今天碰过他没有」，不问碰过之后客人又做了什么。
 * 而这一版把已处理的人整批收进折叠区、还算进进度条的「已完成」——
 * 于是一个一小时前刚回信的客人会被盖在「✓ 今天处理了 N 人」后面，
 * 进度条甚至可能弹「今天全推完了 🎉」。
 *
 * 这跟 PM 那句「我如何知道哪个已经联系了」是同一类伤害，方向反过来：
 * 不是做完的看不见，是**没做完的被当成做完了**。
 */
describe('客人回过头来找我们的，不算已处理', () => {
  it('早上发了邮件、客人下午回了话 → 不算已处理', () => {
    const r = row(
      person([
        ...YESTERDAY_LEAD,
        tp({ direction: 'outbound', occurredAt: '2026-08-05T01:00:00.000Z' }),
        tp({ direction: 'inbound', occurredAt: '2026-08-05T03:00:00.000Z' }),
      ]),
      true,
    )
    expect(r.seg.segment).toBe('replied')
    expect(r.handled).toBe(false)
    expect(r.handledWhy).toBeNull()
  })

  it('上午打电话约好下午回电，到点了 → 不算已处理', () => {
    const r = row(
      person([
        ...YESTERDAY_LEAD,
        tp({
          direction: 'outbound',
          occurredAt: '2026-08-05T01:00:00.000Z',
          callbackAt: '2026-08-05T02:00:00.000Z',
        }),
      ]),
      true,
    )
    expect(r.seg.segment).toBe('callback_due')
    expect(r.handled).toBe(false)
  })

  /** 打了电话客人没动静 —— 这才是真正「做完了」，照旧变灰。 */
  it('打了电话客人没动静 → 照旧算已处理', () => {
    const r = row(
      person([...YESTERDAY_LEAD, tp({ direction: 'outbound', occurredAt: '2026-08-05T01:00:00.000Z' })]),
      true,
    )
    expect(r.handled).toBe(true)
  })

  /** 「他不买了」走的是「已下名单」那条路，不是升级 —— 不受这条影响。 */
  it('今天标了「不买了」→ 仍然算已处理', () => {
    const r = row(
      person([
        ...YESTERDAY_LEAD,
        tp({ direction: 'outbound', occurredAt: '2026-08-05T03:00:00.000Z', outcome: 'not_interested' }),
      ]),
      true,
    )
    expect(r.handled).toBe(true)
    expect(r.handledWhy).toContain('他说不买了')
  })
})

/**
 * 🔴 **客人在同一个桶里又动了一次**（子牙 2026-08-06 第三轮 R3）。
 *
 * 上一版拿「实时版比冻结版更紧急」当「客人又动了」的代理 —— 那只在客人的
 * 动作把人**推去了另一个桶**时成立。同桶再动一次，两边 priority 相等，
 * 代理当场失效，人照旧被折叠进「今天已处理」，`waiting` 那一层漏人。
 *
 * 实测漏掉的 E1（一天之内来回两轮邮件）是接了 info@ 之后 CTS 的日常，
 * 不是构造出来的极端值 —— 卡片自己写着「客户来消息了，已经等了不到 1 小时」，
 * 还是被埋在折叠按钮后面。
 */
describe('客人在同一个桶里又动了一次', () => {
  /** E1：昨天发过 → 今天 12:30 来信 → 今天 14:00 我们回 → 今天 15:30 又来信 */
  it('一天之内来回两轮邮件 → 最后那封仍在等我们，不算已处理', () => {
    const r = row(
      person([
        tp({ direction: 'outbound', occurredAt: '2026-08-04T02:00:00.000Z' }),
        tp({ direction: 'inbound', occurredAt: '2026-08-05T00:30:00.000Z' }),
        tp({ direction: 'outbound', occurredAt: '2026-08-05T02:00:00.000Z' }),
        tp({ direction: 'inbound', occurredAt: '2026-08-05T03:30:00.000Z' }),
      ]),
      true,
    )
    expect(r.seg.segment).toBe('replied')
    expect(r.handled).toBe(false)
  })

  /** 反过来：他早上来信、我们中午回了、之后没动静 —— 这才是真做完了。 */
  it('他来信在我们回之前 → 算已处理', () => {
    const r = row(
      person([
        tp({ direction: 'outbound', occurredAt: '2026-08-04T02:00:00.000Z' }),
        tp({ direction: 'inbound', occurredAt: '2026-08-05T00:30:00.000Z' }),
        tp({ direction: 'outbound', occurredAt: '2026-08-05T02:00:00.000Z' }),
      ]),
      true,
    )
    expect(r.handled).toBe(true)
  })

  /** E3：今天发了信、今天他点了链接 —— 点击是真人动作，算他又动了。 */
  it('我们今天发了信、他今天点了链接 → 不算已处理', () => {
    const r = row(
      person([
        tp({ direction: 'inbound', occurredAt: '2026-08-04T02:00:00.000Z' }),
        tp({ direction: 'outbound', occurredAt: '2026-08-05T01:00:00.000Z' }),
        tp({ direction: 'outbound', occurredAt: '2026-08-05T03:00:00.000Z', engagement: 'click' }),
      ]),
      true,
    )
    expect(r.handled).toBe(false)
  })

  /**
   * **打开不算。** Apple 的隐私保护会替用户自动打开邮件 ——
   * 这套系统 2026-08-02 已经因为把「打开」当成「回话了」出过一次 P0。
   */
  it('他只是打开了邮件（没点）→ 照旧算已处理', () => {
    const r = row(
      person([
        tp({ direction: 'inbound', occurredAt: '2026-08-04T02:00:00.000Z' }),
        tp({ direction: 'outbound', occurredAt: '2026-08-05T01:00:00.000Z' }),
        tp({ direction: 'outbound', occurredAt: '2026-08-05T03:00:00.000Z', engagement: 'open' }),
      ]),
      true,
    )
    expect(r.handled).toBe(true)
  })

  /** E2：身上挂着一个过期旧约，今晨又约了今天下午 —— 同桶，上一版照旧被埋。 */
  it('挂着旧约、今晨又约了今天下午，到点了 → 不算已处理', () => {
    const r = row(
      person([
        tp({ direction: 'inbound', occurredAt: '2026-08-01T02:00:00.000Z' }),
        tp({ direction: 'outbound', occurredAt: '2026-08-02T02:00:00.000Z', callbackAt: '2026-08-03T02:00:00.000Z' }),
        tp({ direction: 'outbound', occurredAt: '2026-08-04T22:00:00.000Z', callbackAt: '2026-08-05T02:00:00.000Z' }),
      ]),
      true,
    )
    expect(r.handled).toBe(false)
  })

  /**
   * **卡片上必须是新约的时间，不是那个过期旧约**（R4）。
   *
   * 摘掉的话卡片会翻出两天前那个旧约，写着「之前约好这个时间回电 · 2 天前」
   * —— 销售拿起电话第一句就说错。
   *
   * ⚠️ 修法的**落点**很要紧：不能把整条带 `callbackAt` 的触点从冻结里豁免
   * （第一版就是那么干的，副作用见下面「备注里提个时间」那一组），
   * 只能让 `dueAt` 这一个显示值取实时的。
   */
  it('卡片显示今晨新约的时间，不是过期的旧约', () => {
    const r = row(
      person([
        tp({ direction: 'inbound', occurredAt: '2026-08-01T02:00:00.000Z' }),
        tp({ direction: 'outbound', occurredAt: '2026-08-02T02:00:00.000Z', callbackAt: '2026-08-03T02:00:00.000Z' }),
        tp({ direction: 'outbound', occurredAt: '2026-08-04T22:00:00.000Z', callbackAt: '2026-08-05T02:00:00.000Z' }),
      ]),
      true,
    )
    expect(r.seg.dueAt).toBe('2026-08-05T02:00:00.000Z')
  })

  /** 今天还没出过手 → 谈不上「出手之后」，这个人本来就不是已处理。 */
  it('今天一次都没出手 → 判据不生效', () => {
    const r = row(person(YESTERDAY_LEAD), false)
    expect(r.handled).toBe(false)
  })
})

/**
 * 🔴 **备注里随手提一句时间，人就换桶 / 消失**（子牙 2026-08-06 第四轮 R5）。
 *
 * 上一版为了让卡片显示新约的时间，把整条带 `callbackAt` 的触点从冻结里
 * 豁免了出去 —— 于是这通电话的方向、时间、通话结果、出行意向**全部**
 * 对冻结版可见，冻结当场失效。而 `note-parser` 会把通话备注里的时间
 * 自动解析成回电约定，所以触发条件只是「销售随手写了句几点再打」。
 *
 * 实测（唯一变量就是备注里提没提时间）：
 *   没提       → 留在「新客人，还没打过」  ✓
 *   「今晚6点」 → 跳到「聊过了，没下文」    ✗
 *   「明年三月走，下周再打」→ **人从名单上彻底消失** ✗
 *
 * 最后一条是这个 PR 存在的全部理由被自己的补丁推翻 —— 而那句备注
 * 是通话记录里最常见的写法之一。
 */
describe('通话备注里提了个时间，不许因此换桶或消失', () => {
  const calledToday = (over: Partial<TouchpointLike> = {}) =>
    row(
      person([
        tp({ direction: 'inbound', occurredAt: '2026-08-04T02:00:00.000Z' }),
        tp({ direction: 'outbound', occurredAt: '2026-08-05T01:00:00.000Z', ...over }),
      ]),
      true,
    )

  it('基准：备注没提时间 → 留在原桶', () => {
    expect(calledToday().seg.segment).toBe('new_untouched')
  })

  it('备注写了「今晚 6 点再打」→ 仍然留在原桶，不许换', () => {
    expect(calledToday({ callbackAt: '2026-08-05T06:00:00.000Z' }).seg.segment).toBe('new_untouched')
  })

  /** 最狠的一个：出行意向跟着漏进冻结版，整个人从名单上不见。 */
  it('备注写「明年三月走，下周再打」→ 人必须还在名单上', () => {
    const r = calledToday({ callbackAt: '2026-08-12T01:00:00.000Z', travelWindow: '明年三月' })
    expect(r.onList).toBe(true)
    expect(r.seg.segment).toBe('new_untouched')
  })

  /** 备注被解析成「没接」也一样 —— 通话结果同样不该漏进冻结版。 */
  it('备注解析出「没接」→ 仍然留在原桶', () => {
    expect(calledToday({ callbackAt: '2026-08-05T06:00:00.000Z', outcome: 'no_answer' }).seg.segment)
      .toBe('new_untouched')
  })
})

/**
 * 打的就是那个约好的电话 —— 打完要变灰。
 *
 * `needsMeAgain` 里 `tsOf(live.dueAt) > ourLast` 这一项守的就是它：
 * 没有它的话，一个约在 8/3、我们 8/5 打了的人，`live.dueAt` 还是 8/3、
 * 仍然「已经到点」，`callbackCameDue` 恒为真 —— **这个人打了也永远灰不了，
 * 明天后天照旧堵在待办最前面**。
 */
describe('打的就是那个约好的电话', () => {
  it('约在两天前、今天补打了 → 算已处理', () => {
    const r = row(
      person([
        tp({ direction: 'inbound', occurredAt: '2026-08-01T02:00:00.000Z' }),
        tp({ direction: 'outbound', occurredAt: '2026-08-02T02:00:00.000Z', callbackAt: '2026-08-03T02:00:00.000Z' }),
        tp({ direction: 'outbound', occurredAt: '2026-08-05T01:00:00.000Z' }),
      ]),
      true,
    )
    expect(r.handled).toBe(true)
  })
})

/**
 * 「跟进了」和「关掉了」必须分得开（板桥 2026-08-06，销售视角复审）。
 *
 * 折叠按钮上那个「今天处理了 8 人」把两件性质完全不同的事盖在一个数字里：
 * 打了电话（活还在）和标了不买（线断了）。他的原话是
 * **「一个不该当业绩看的数字，长得太像业绩了」**——
 * 而且混着数之后，清空今天名单最快的办法会变成把人全标死。
 */
describe('跟进了 / 关掉了，要分得开', () => {
  it('打了电话 → 算「跟进」', () => {
    const r = row(
      person([...YESTERDAY_LEAD, tp({ direction: 'outbound', occurredAt: '2026-08-05T03:00:00.000Z' })]),
      true,
    )
    expect(r.handledKind).toBe('followed')
  })

  it.each([
    ['标了不买', { outcome: 'not_interested' }],
    ['号码不通', { outcome: 'bad_number' }],
  ])('%s → 算「关掉」', (_label, over) => {
    const r = row(
      person([
        ...YESTERDAY_LEAD,
        tp({ direction: 'outbound', occurredAt: '2026-08-05T03:00:00.000Z', ...over }),
      ]),
      true,
    )
    expect(r.handledKind).toBe('closed')
  })

  it('没动过的人 → 两边都不算', () => {
    expect(row(person(YESTERDAY_LEAD)).handledKind).toBeNull()
  })

  /** 客人回过头来找我们的，既不算跟进也不算关掉 —— 他还欠我们一次动作。 */
  it('客人又回话了 → 不算已处理，也没有类别', () => {
    const r = row(
      person([
        ...YESTERDAY_LEAD,
        tp({ direction: 'outbound', occurredAt: '2026-08-05T01:00:00.000Z' }),
        tp({ direction: 'inbound', occurredAt: '2026-08-05T03:00:00.000Z' }),
      ]),
      true,
    )
    expect(r.handledKind).toBeNull()
  })

  /**
   * 「标了：」这三个字说清**这是你刚才做的动作**，不是系统对这个人的评价。
   * 没有它，卡片上一个绿勾配一句「号码是坏的」，读起来像「✓ 打不通」是个成就。
   */
  it('关掉的理由前面带「标了：」', () => {
    const r = row(
      person([
        ...YESTERDAY_LEAD,
        tp({ direction: 'outbound', occurredAt: '2026-08-05T03:00:00.000Z', outcome: 'not_interested' }),
      ]),
      true,
    )
    expect(r.handledWhy?.startsWith('标了：')).toBe(true)
  })
})

/**
 * 🔴 **群发不算「我们出手」**（魏征 2026-08-06 验收）。
 *
 * 全仓「我们出手」有三处判据，另外两处都记得排掉机器发的，只有 `needsMeAgain`
 * 漏了 —— 而它正是这个 PR 为了堵「客人回了信却被折叠」新写的那个函数。
 *
 * 实测：同一个人，唯一变量是多一封 16:00 的群发
 *   没群发 → replied,       handled:false  ✓ 他在等我们
 *   有群发 → new_untouched, handled:true   ✗ 被折叠掉了
 *
 * 触发一点都不苛刻：日发一封 newsletter，当天被真人跟过又回了信的那几个
 * （名单上最烫的人）全中。
 */
describe('群发不算「我们出手」', () => {
  const withReply = [
    tp({ direction: 'inbound', occurredAt: '2026-08-04T02:00:00.000Z' }),
    tp({ direction: 'outbound', occurredAt: '2026-08-04T22:00:00.000Z' }), // 上午真人跟
    tp({ direction: 'inbound', occurredAt: '2026-08-05T03:00:00.000Z' }), // 下午客人回信
  ]

  it('基准：真人跟过、客人回了信 → 他在等我们', () => {
    const r = row(person(withReply), true)
    expect(r.seg.segment).toBe('replied')
    expect(r.handled).toBe(false)
  })

  /**
   * 修的是 `handled` —— **这个人不许被折叠进「今天已处理」**。
   *
   * ⚠️ 他落在哪一批（`seg.segment`）这一版**没修好**：`segmentContact` 在
   * main 上就不认 automated，一封群发照样被它当成「我们最后一次出站」，
   * 于是「客人回话了」那条规则不成立，人掉进别的桶。那是既有毛病、
   * 影响面比这个 PR 大得多（分批规则是所有页面共用的），单独记进
   * ROADMAP M2.7f，不在这里顺手改。
   *
   * 但两半的代价差一个量级：落错桶只是排序不理想，**被折叠掉是根本看不见**。
   */
  it('回信之后又发了一封群发 → 不许被当成已处理折叠掉', () => {
    const r = row(
      person([
        ...withReply,
        tp({ direction: 'outbound', occurredAt: '2026-08-05T03:30:00.000Z', automated: true }),
      ]),
      true,
    )
    expect(r.handled).toBe(false)
    expect(r.handledWhy).toBeNull()
  })

  /** 反过来：只有群发、没有真人跟过 —— 那本来就不该算我们出过手。 */
  it('只有群发、没人真的跟过 → 判据不生效', () => {
    const r = row(
      person([
        tp({ direction: 'inbound', occurredAt: '2026-08-04T02:00:00.000Z' }),
        tp({ direction: 'outbound', occurredAt: '2026-08-05T01:00:00.000Z', automated: true }),
        tp({ direction: 'inbound', occurredAt: '2026-08-05T03:00:00.000Z' }),
      ]),
      false,
    )
    expect(r.handled).toBe(false)
  })
})

/**
 * **「就地」这两个字，是这个 PR 的招牌承诺 —— 之前一条用例都没有**
 * （魏征 2026-08-06 验收）。
 *
 * 原先只钉了「桶不变」和「两个人的相对顺序」。将来谁给 `dayWorklist` 加一句
 * 「已处理的沉底」，那些用例一条都不会响 —— 而那正好把这个 PR 要修的毛病
 * 原样改回去。
 */
describe('处理过的人留在原位，顺序一字不变', () => {
  it('三个人，把中间那个处理掉 → 顺序不变', () => {
    const people = ['a', 'b', 'c'].map((id) => ({ ...person(YESTERDAY_LEAD), id }))
    const before = dayWorklist(people, NOW, { dayStartMs: DAY_START, touchedToday: () => false })
    const after = dayWorklist(people, NOW, {
      dayStartMs: DAY_START,
      touchedToday: (id) => id === 'b',
    })

    expect(before.map((r) => r.id)).toEqual(after.map((r) => r.id))
    expect(after.map((r) => r.id)).toHaveLength(3)
    expect(after.find((r) => r.id === 'b')!.handled).toBe(true)
  })
})

/**
 * 「取消推迟」= 把人**捞回来打电话**，不是「已经联系过他了」。
 *
 * Codex 复审 2026-08-15 第三轮。推迟和取消推迟都会写一笔真人出站触点
 * （为了留痕，也为了让冻结判据认得出），但那是**安排名单**的动作，
 * 客人那头什么都没收到。
 *
 * 不排掉的话，最刺眼的是取消推迟：销售在「不在今天名单上的人」里点
 * 「现在就叫回来」，人回到名单上却**当场是灰的、写着「今天联系过了」**，
 * 进度还加了一格 —— 他刚刚明明是想把这个人捞回来打电话。
 *
 * 这里钉的是 `dayRow` 这一侧的契约：`touchedToday` 传 false 时（读路径已经
 * 把 snooze 触点排掉了），人必须是**待办**，不是已处理。
 */
describe('取消推迟：捞回来的人必须是待办，不是已联系', () => {
  const UNSNOOZE_TODAY = tp({
    direction: 'outbound',
    occurredAt: '2026-08-05T03:00:00.000Z',
    action: 'snooze',
  })

  it('捞回来的人留在名单上，而且不是灰的', () => {
    // snoozeUntil 已被清空（取消推迟），读路径把 snooze 触点排除在「今天动过」之外
    const r = row(person([...YESTERDAY_LEAD, UNSNOOZE_TODAY], { snoozeUntil: null }), false)
    expect(r.onList).toBe(true)
    expect(r.handled).toBe(false)
    expect(r.handledWhy).toBeNull()
  })

  /**
   * 反过来那一头不能被误伤：**真的推迟**照样要算已处理。
   * 它不靠 `touchedToday`，靠实时版看得见 `snooze_until` → `droppedOff`。
   */
  it('真推迟的人照样变灰（走 droppedOff，不靠「今天动过」）', () => {
    const r = row(
      person([...YESTERDAY_LEAD, UNSNOOZE_TODAY], { snoozeUntil: '2026-08-12T00:00:00.000Z' }),
      false,
    )
    expect(r.onList).toBe(true)
    expect(r.handled).toBe(true)
    expect(r.handledKind).toBe('closed')
  })
})

/**
 * **「取消推迟」这个标记绝不能去清冻结副本上的推迟**（Codex 第四轮）。
 *
 * 写入是两步、且不在一个事务里：先写这一笔记录，再把 `snooze_until` 清空。
 * 第二步失败时，**旧的推迟依然有效**。这时如果那一笔记录标的是 `'snooze'`，
 * 读路径会拿它去清掉那个真实存在的推迟 —— 一次**失败**的「叫回来」，
 * 刷新之后反而把人挪进了今天的名单，还标成灰的。
 *
 * 所以两个动作必须是两个值：`'snooze'` 清，`'unsnooze'` 什么都不清。
 */
describe('取消推迟的标记不清任何东西', () => {
  const list = (c: ContactLike) =>
    dayWorklist([c], NOW, { dayStartMs: DAY_START, touchedToday: () => false })

  const UNSNOOZE = tp({
    direction: 'outbound',
    occurredAt: '2026-08-05T03:00:00.000Z',
    action: 'unsnooze',
  })

  it('叫回来失败了（推迟还在）→ 人照旧不在今天的名单上', () => {
    expect(
      list(person([...YESTERDAY_LEAD, UNSNOOZE], { snoozeUntil: '2026-09-12T00:00:00.000Z' })),
    ).toHaveLength(0)
  })

  it('对照：同样的场景换成 snooze 标记，人会被放回名单 —— 正是要避免的那个结果', () => {
    const withSnoozeMark = tp({
      direction: 'outbound',
      occurredAt: '2026-08-05T03:00:00.000Z',
      action: 'snooze',
    })
    expect(
      list(person([...YESTERDAY_LEAD, withSnoozeMark], { snoozeUntil: '2026-09-12T00:00:00.000Z' })),
    ).toHaveLength(1)
  })
})

/**
 * 🔴 **管理动作不许盖住客人的回信**（Codex 复审 2026-08-15 第六轮）。
 *
 * 跟魏征 2026-08-06 抓到的「群发盖住回信」是同一种伤害，另一个入口：
 * 「推迟 / 取消推迟」也写成真人出站触点（为了留痕），但**客人那头什么都没
 * 收到**，它们不能算「我们出手了」。
 *
 * 会真发生的一串：09:00 我们发了邮件 → 10:00 客人回信 →
 * 11:00 销售从名单外把另一个人叫回来。不排掉的话「我们最后一次出手」
 * 变成 11:00，客人 10:00 那封回信就「早于我们出手」→ 判定他没在等 →
 * **一个正等着回话的客人当天被折叠进「今天动过」。**
 */
describe('推迟 / 取消推迟不算「我们出手了」', () => {
  const AT_9 = '2026-08-05T02:00:00.000Z'
  const AT_10 = '2026-08-05T03:00:00.000Z'
  const AT_11 = '2026-08-05T04:00:00.000Z'

  const withAdminAction = (action: 'snooze' | 'unsnooze') =>
    person([
      ...YESTERDAY_LEAD,
      tp({ direction: 'outbound', occurredAt: AT_9 }),            // 09:00 我们发的
      tp({ direction: 'inbound', occurredAt: AT_10 }),            // 10:00 客人回的
      tp({ direction: 'outbound', occurredAt: AT_11, action }),   // 11:00 管理动作
    ])

  it.each(['snooze', 'unsnooze'] as const)(
    '%s 之后，客人 10 点那封回信照样算「他在等我」',
    (action) => {
      const r = dayRow(withAdminAction(action), new Date(AT_11), {
        dayStartMs: DAY_START,
        touchedToday: true,
      })
      expect(r.handled).toBe(false)
    },
  )

  /** 对照：真的又发了一封（不是管理动作）—— 那才叫我们回过他了。 */
  it('对照：11 点真的又发了一封 → 算我们回过他了', () => {
    const r = dayRow(
      person([
        ...YESTERDAY_LEAD,
        tp({ direction: 'outbound', occurredAt: AT_9 }),
        tp({ direction: 'inbound', occurredAt: AT_10 }),
        tp({ direction: 'outbound', occurredAt: AT_11 }),
      ]),
      new Date(AT_11),
      { dayStartMs: DAY_START, touchedToday: true },
    )
    expect(r.handled).toBe(true)
  })
})

/**
 * 🔴 **「这条路通不通」不该被冻结**（Codex 复审 2026-08-16）。
 *
 * 冻结要挡住的是「我们今天做了什么」对**位置**的影响。但销售今天刚标了
 * 「号码是坏的」，那条出站触点会被 `withoutOurActionsSince` 从冻结副本里
 * 摘掉 —— 冻结版照旧认为电话能打，卡上**继续挂着那个号码的拨号链接**，
 * 要到明天才承认它是坏的。他刚刚才发现打不通，系统却请他再打一次。
 */
describe('号码今天刚标坏，卡片当天就得认', () => {
  const markedBadToday = (over: Partial<ContactLike> = {}) =>
    person(
      [
        ...YESTERDAY_LEAD,
        tp({
          direction: 'outbound',
          channel: 'phone',
          occurredAt: '2026-08-05T03:00:00.000Z',
          outcome: 'bad_number',
        }),
      ],
      { hasPhone: true, hasEmail: true, ...over },
    )

  it('当天就说「这个号打不通」，不用等到明天', () => {
    expect(row(markedBadToday(), true).seg.phoneUnusable).toBe(true)
  })

  it('建议渠道当天就降级到邮件 —— 别再把那个号推回去让他打', () => {
    expect(row(markedBadToday(), true).seg.suggestedChannel).toBe('email')
  })

  /** 但位置照旧按冻结版走 —— 这才是「名单一天不变」那条规则本身。 */
  it('人还留在原来那一批，没因为标了坏号就换位置', () => {
    expect(row(markedBadToday(), true).seg.segment).toBe('new_untouched')
  })

  /** 没标坏号的人，一个字都不该变。 */
  it('号码好好的人不受影响', () => {
    const r = row(person(YESTERDAY_LEAD, { hasPhone: true, hasEmail: true }))
    expect(r.seg.phoneUnusable).toBe(false)
    expect(r.seg.suggestedChannel).toBe('phone')
  })
})

/**
 * 🔴 **号码今天修好了，也得当天恢复**（Codex 复审 2026-08-16 第二轮）。
 *
 * 只处理「今天变坏」那一半的话，早上还是坏号、今天真的打通了的人，卡上会
 * **整天继续说这个号打不通**、电话一直被禁用 —— 而销售手上刚打通过。
 */
describe('号码今天打通了，卡片当天就得恢复', () => {
  const badThenSpokeToday = person(
    [
      ...YESTERDAY_LEAD,
      tp({
        direction: 'outbound',
        channel: 'phone',
        occurredAt: '2026-08-03T03:00:00.000Z',
        outcome: 'bad_number',
      }),
      tp({
        direction: 'outbound',
        channel: 'phone',
        occurredAt: '2026-08-05T03:00:00.000Z',
        outcome: 'spoke',
      }),
    ],
    { hasPhone: true, hasEmail: true },
  )

  it('当天就不再说「这个号打不通」', () => {
    expect(row(badThenSpokeToday, true).seg.phoneUnusable).toBe(false)
  })

  it('电话当天就放回来 —— 他刚打通过', () => {
    expect(row(badThenSpokeToday, true).seg.suggestedChannel).toBe('phone')
  })
})

/**
 * 🔴 **拨到一个空号不算「今天跟进过他了」**（Codex 复审 2026-08-16 第五轮）。
 *
 * 销售拨过去发现是空号、顺手标了坏号 —— **这件事没有到达客人**：他什么都没
 * 收到，还在等我们。算成「今天出手过」的话，卡片当场折进「今天已处理」、
 * 进度条算完成、群发邮件还会把他排除掉，而正确的下一步（改用邮件 / 私信联系他）
 * **一次都还没做**。待办就这么被藏起来了。
 *
 * ⚠️ 判据本身在 today 路由的 `touchedTodayIds` 里（它才决定这个开关），
 * 共用 `isFailedReach`。这里钉的是**开关拨到该拨的位置时，这个人的样子**：
 * 不变灰、留在名单上，等着有人改用邮件联系他。
 */
describe('拨到空号不算今天跟进过', () => {
  const dialedDeadToday = person(
    [
      ...YESTERDAY_LEAD,
      tp({
        direction: 'outbound',
        channel: 'phone',
        occurredAt: '2026-08-05T03:00:00.000Z',
        outcome: 'bad_number',
      }),
    ],
    { hasPhone: true, hasEmail: true },
  )

  it('不折进「今天已处理」—— 该发的邮件一封都还没发', () => {
    expect(row(dialedDeadToday, false).handled).toBe(false)
  })

  it('人还在名单上，等着有人改用邮件联系他', () => {
    expect(row(dialedDeadToday, false).onList).toBe(true)
  })

  it('卡片当天就说这个号打不通，并把渠道降到邮件', () => {
    const r = row(dialedDeadToday, false)
    expect(r.seg.phoneUnusable).toBe(true)
    expect(r.seg.suggestedChannel).toBe('email')
  })
})

/**
 * 行业剧本拆分之后新加的测试。`dayRow` 内部对同一个 `contact` 调用了
 * 两次 `segmentContact`（冻结版一次、实时版一次）—— 拆分前这两次调用都是
 * 硬编码的旅游逻辑，拆分后两次都必须读同一个传入的 `playbook`，不能有
 * 任何一次悄悄退回默认的 `TOURISM_PLAYBOOK`。默认值今天会把这种漏传焊死
 * 到看起来一致（两边都落到默认剧本），所以必须用一个**非默认**的 playbook
 * 才能把这条裂缝测出来。
 */
describe('自定义 playbook 必须真的接进 dayRow，不能悄悄退回默认剧本', () => {
  const ALWAYS_DUE: IndustryPlaybook = {
    resolveWaitSignal: () => ({ due: true, nurtureReason: 'x', reengagedReason: 'y' }),
  }
  // 很久以前（不是今天）说过出行时间，冻结不会把它摘掉。
  const spokeLongAgo = [
    tp({ direction: 'outbound', occurredAt: '2026-07-14T00:00:00.000Z', travelWindow: '明年三月' }),
  ]

  it('基准：默认旅游剧本判「以后才走」，不进今天名单', () => {
    const r = dayRow(person(spokeLongAgo), NOW, { dayStartMs: DAY_START, touchedToday: false })
    expect(r.seg.segment).toBe('nurture_future')
    expect(r.onList).toBe(false)
  })

  it('换成「一律当到期」的剧本，onList 必须跟着变 —— 证明冻结版真的用了传入的 playbook', () => {
    const r = dayRow(person(spokeLongAgo), NOW, {
      dayStartMs: DAY_START, touchedToday: false, playbook: ALWAYS_DUE,
    })
    expect(r.seg.segment).not.toBe('nurture_future')
    expect(r.onList).toBe(true)
  })

  it('resolveWaitSignal 恰好被调用两次 —— 冻结版和实时版用的是同一个传入的 playbook', () => {
    let calls = 0
    const spy: IndustryPlaybook = {
      resolveWaitSignal: () => {
        calls++
        return null
      },
    }
    dayRow(person(spokeLongAgo), NOW, { dayStartMs: DAY_START, touchedToday: false, playbook: spy })
    expect(calls).toBe(2)
  })

  /** `dayWorklist` 也要把 playbook 透传给它内部调的 `dayRow`，不能在半路弄丢。 */
  it('dayWorklist 同样把 playbook 传到底', () => {
    const rows = dayWorklist([person(spokeLongAgo)], NOW, {
      dayStartMs: DAY_START,
      touchedToday: () => false,
      playbook: ALWAYS_DUE,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].seg.segment).not.toBe('nurture_future')
  })
})

describe('接通后记了笔记，灰勾和卡片说的是同一件事', () => {
  const spoke = (at: string): TouchpointLike =>
    tp({
      channel: 'phone',
      direction: 'outbound',
      occurredAt: at,
      source: 'twilio',
      outcome: 'spoke',
    })
  const note = (at: string): TouchpointLike =>
    tp({
      channel: 'phone',
      direction: 'outbound',
      occurredAt: at,
      source: 'me_manual',
      outcome: 'spoke',
    })

  it('刚通完电话并记下笔记 → handledWhy 与理由一致，不说他还没回', () => {
    const r = row(
      person([
        ...YESTERDAY_LEAD,
        spoke('2026-08-05T03:00:00.000Z'),
        note('2026-08-05T03:20:00.000Z'),
      ]),
      true,
    )
    expect(r.handled).toBe(true)
    expect(r.seg.afterCall).toBe(false)
    expect(r.seg.reason).toBe('刚通完电话，今天已记录')
    expect(r.handledWhy).toBe('刚通完电话，今天已记录')
  })

  it('几天前通的电话、今天才记 → 两边都说「通完电话，今天已记录」', () => {
    const r = row(
      person([
        tp({ direction: 'inbound', occurredAt: '2026-08-01T02:00:00.000Z' }),
        spoke('2026-08-03T02:00:00.000Z'),
        note('2026-08-05T03:20:00.000Z'),
      ]),
      true,
    )
    expect(r.handled).toBe(true)
    expect(r.seg.reason).toBe('通完电话，今天已记录')
    expect(r.handledWhy).toBe('通完电话，今天已记录')
  })
})
