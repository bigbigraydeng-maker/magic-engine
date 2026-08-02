/**
 * 卡片上的跟进标记。
 *
 * 这里钉的是三件「早上一眼要看懂」的事，外加一条不能破的底线：
 *
 *   **打开邮件只做标记，绝不参与排序、绝不进桶。**
 *
 * 2026-08-02 那次 P0 就是把「打开」当成「客户回话了」，最高优先桶从 15 人涨到
 * 200 人，15 个真在等回复的客户被埋掉。Apple 隐私保护会替用户自动打开邮件 ——
 * 「打开」连「他看过」都不能证明。所以它在这里只能是一条提示。
 */

import { describe, expect, it } from 'vitest'
import { followUpMarks, shortActor, type TouchLike } from '../follow-up-marks'

const NOW = new Date('2026-08-02T14:00:00+12:00')

const call = (at: string, over: Partial<TouchLike> = {}): TouchLike => ({
  direction: 'outbound',
  occurredAt: at,
  summary: '聊了长城团',
  loggedBy: 'sales@cts.co.nz',
  ...over,
})

describe('今天动过他没有', () => {
  it('今天打过 → 标记为已跟', () => {
    expect(followUpMarks([call('2026-08-02T09:00:00+12:00')], NOW).doneToday).toBe(true)
  })

  /** 「今天」是自然日，不是 24 小时内 —— 昨天下午打的不该让今天的卡看起来做完了。 */
  it('昨天下午打的 → 今天仍然要做', () => {
    expect(followUpMarks([call('2026-08-01T17:00:00+12:00')], NOW).doneToday).toBe(false)
  })

  /**
   * 这条钉的是一个真实 bug：服务器跑在 UTC，销售在新西兰（UTC+12）。
   * 按服务器的日子算，他上午 9 点打的电话落在「昨天」；等纽西兰到中午、
   * UTC 跨日，他一早做完的活会**集体变回「没做」**。
   */
  it('按客户所在地的日子算，不按服务器的 —— 纽西兰上午打的就是今天打的', () => {
    // 纽西兰 8/2 上午 9 点 = UTC 8/1 21:00（服务器眼里还是昨天）
    const nzMorning = call('2026-08-02T09:00:00+12:00')
    expect(followUpMarks([nzMorning], NOW, 'Pacific/Auckland').doneToday).toBe(true)
    // 同一条记录，按 UTC 算就成了昨天 —— 这正是原来的错法
    expect(followUpMarks([nzMorning], NOW, 'UTC').doneToday).toBe(false)
  })

  it('时区字符串坏了也不炸，名单照样打得开', () => {
    expect(() => followUpMarks([call('2026-08-02T09:00:00+12:00')], NOW, '不是时区')).not.toThrow()
  })

  it('今天是客人来的消息，不是我们动的 → 不算已跟', () => {
    const inbound = call('2026-08-02T09:00:00+12:00', { direction: 'inbound' })
    expect(followUpMarks([inbound], NOW).doneToday).toBe(false)
  })

  it('今天他打开了邮件 → 不算我们跟过他', () => {
    const opened = call('2026-08-02T09:00:00+12:00', { engagement: 'open' })
    expect(followUpMarks([opened], NOW).doneToday).toBe(false)
  })
})

/**
 * 这一组钉的是一个会毁掉整个功能的细节：Mailchimp 群发在数据上跟销售亲手打的
 * 一通电话长得一模一样（都是 outbound、都不带打开/点击标记）。不分开的话，
 * 一封群发会把整块看板标成「今天已经跟过」，销售第二天早上看到几百张灰卡，
 * 会以为活都做完了。
 */
describe('机器发的不算「有人跟过他」', () => {
  it('今天群发过邮件 → 不算今天跟过他', () => {
    const blast = call('2026-08-02T09:00:00+12:00', { automated: true })
    expect(followUpMarks([blast], NOW).doneToday).toBe(false)
  })

  it('群发不占「上次谁跟的」', () => {
    const marks = followUpMarks(
      [
        call('2026-07-28T09:00:00+12:00', { loggedBy: 'amy@cts.co.nz' }),
        call('2026-08-01T09:00:00+12:00', { automated: true, loggedBy: null, summary: '已发·静默唤回' }),
      ],
      NOW,
    )
    expect(marks.lastBy).toBe('amy')
  })

  it('人亲手群发那一次（页面上点的「帮我记一笔」）照样算 —— 那是人的动作', () => {
    const byHand = call('2026-08-02T09:00:00+12:00', { summary: '群发了一封邮件' })
    expect(followUpMarks([byHand], NOW).doneToday).toBe(true)
  })

  /** 群发之后客人打开了邮件，那条「打开了」的提示要照常挂着 —— 没人跟过他。 */
  it('群发之后他打开了 → 提示照常挂着', () => {
    const marks = followUpMarks(
      [
        call('2026-07-30T09:00:00+12:00', { automated: true }),
        call('2026-07-31T09:00:00+12:00', { engagement: 'open', loggedBy: null }),
      ],
      NOW,
    )
    expect(marks.openedDaysAgo).toBe(2)
  })
})

describe('昨天是谁跟的', () => {
  it('取最近一次我们做的动作上记的人', () => {
    const marks = followUpMarks(
      [
        call('2026-07-30T09:00:00+12:00', { loggedBy: 'amy@cts.co.nz' }),
        call('2026-08-01T09:00:00+12:00', { loggedBy: 'bob@cts.co.nz' }),
      ],
      NOW,
    )
    expect(marks.lastBy).toBe('bob')
  })

  /** 历史导入和自动写入没有这个信息。不知道就说不知道，不拿别人的名字顶上。 */
  it('没记录人 → null，页面按「不知道谁跟的」显示', () => {
    expect(followUpMarks([call('2026-08-01T09:00:00+12:00', { loggedBy: null })], NOW).lastBy).toBeNull()
  })

  it('只看我们做的动作 —— 客人来的消息上没有「谁跟的」可言', () => {
    const marks = followUpMarks(
      [call('2026-08-01T10:00:00+12:00', { direction: 'inbound', loggedBy: 'amy@cts.co.nz' })],
      NOW,
    )
    expect(marks.lastBy).toBeNull()
  })
})

describe('上次聊到哪了', () => {
  it('用我们最近一次动作的摘要', () => {
    const marks = followUpMarks(
      [
        call('2026-07-30T09:00:00+12:00', { summary: '第一次通话' }),
        call('2026-08-01T09:00:00+12:00', { summary: '想明年三月去' }),
      ],
      NOW,
    )
    expect(marks.lastNote).toBe('想明年三月去')
  })

  /** 新线索我们还没联系过 —— 上下文就是他自己说的那句。 */
  it('我们还没联系过 → 用他自己说的那句当上下文', () => {
    const marks = followUpMarks(
      [call('2026-08-01T09:00:00+12:00', { direction: 'inbound', summary: '填了 Facebook 表单 · 长城 8 天' })],
      NOW,
    )
    expect(marks.lastNote).toBe('填了 Facebook 表单 · 长城 8 天')
  })

  it('摘要是空的就是 null，不显示一个空框', () => {
    expect(followUpMarks([call('2026-08-01T09:00:00+12:00', { summary: '   ' })], NOW).lastNote).toBeNull()
  })
})

describe('打开了邮件 —— 只做提示，绝不参与排序', () => {
  const opened = (at: string) => call(at, { engagement: 'open', summary: null, loggedBy: null })

  it('3 天前打开过、之后没人联系他 → 挂一条提示', () => {
    expect(followUpMarks([opened('2026-07-30T14:00:00+12:00')], NOW).openedDaysAgo).toBe(3)
  })

  it('打开之后我们已经联系过了 → 提示撤掉，别再挂着', () => {
    const marks = followUpMarks(
      [opened('2026-07-30T14:00:00+12:00'), call('2026-08-01T09:00:00+12:00')],
      NOW,
    )
    expect(marks.openedDaysAgo).toBeNull()
  })

  it('从没打开过 → 没有这条提示', () => {
    expect(followUpMarks([call('2026-08-01T09:00:00+12:00')], NOW).openedDaysAgo).toBeNull()
  })

  /**
   * 这条是底线：打开不能冒充「我们跟过他」，也不能冒充「他找过我们」。
   * 一个只打开过邮件的人，在标记上必须看起来跟「什么都没发生」一样 ——
   * 除了那条提示本身。
   */
  it('只打开过邮件的人：不算已跟、没有谁跟的、没有上次聊什么', () => {
    const marks = followUpMarks([opened('2026-08-02T09:00:00+12:00')], NOW)
    expect(marks).toMatchObject({
      doneToday: false,
      lastBy: null,
      lastNote: null,
    })
    expect(marks.openedDaysAgo).toBe(0)
  })
})

describe('shortActor', () => {
  it('只留 @ 前面那截 —— 卡片一行放不下整个地址', () => {
    expect(shortActor('bigbigraydeng@gmail.com')).toBe('bigbigraydeng')
  })
  it('空值就是 null', () => {
    expect(shortActor(null)).toBeNull()
    expect(shortActor('  ')).toBeNull()
  })
})
