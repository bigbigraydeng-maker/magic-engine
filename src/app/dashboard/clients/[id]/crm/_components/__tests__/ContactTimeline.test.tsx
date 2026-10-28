/**
 * 往来记录里，**系统做过的判决必须看得见**。
 *
 * 背景（PM 2026-08-17）：`do_not_contact` 一旦成立，电话 / 邮件 / 私信全停，
 * 解闸只能靠人明确说「判错了」。可在这之前，这条判决在时间线上跟一条普通电话
 * 记录长得一模一样 —— 接口早就把 `outcome` 送到前端了，组件却一个字都没渲染。
 *
 * 于是最该被复核的那一刻恰恰最看不见：销售翻记录只看到一句话，看不到
 * 「就是这一句让系统把他全渠道停了」。而早前的词表确实把「我不打算去」
 * 当成过「别再联系」—— 被误判的人收不到我们任何消息。
 *
 * 🔴 原话必须留在判决旁边：判断是不是判错了，全靠原话。
 */

import React from 'react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ContactTimeline, stageSourceOf, type TimelineEntry } from '../ContactTimeline'

const touch = (over: Partial<TimelineEntry> = {}): TimelineEntry => ({
  kind: 'touch',
  at: '2026-08-10T00:00:00Z',
  channel: 'phone',
  direction: 'outbound',
  summary: '打过去聊了两句',
  ...over,
})

function mockTimeline(timeline: TimelineEntry[]) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      contact: { name: 'Sue', phone: null, email: null, stageLabel: null },
      timeline,
    }),
  }) as unknown as typeof fetch
}

const draw = () => render(<ContactTimeline clientId="cts" contactId="c1" />)

beforeEach(() => vi.restoreAllMocks())
afterEach(() => vi.restoreAllMocks())

describe('系统给他上了闸 —— 必须一眼看见', () => {
  it('🔒「别再联系」那条写明后果，不是只写个结论名', async () => {
    mockTimeline([touch({ summary: '客户说别再打给我了', outcome: 'do_not_contact' })])
    draw()
    // 说的是「所以现在怎么样」，销售不用去猜 do_not_contact 是什么意思
    await waitFor(() =>
      expect(screen.getByText(/电话 \/ 邮件 \/ 私信全都不再发给他/)).toBeTruthy(),
    )
  })

  it('🔴 原话还在判决旁边 —— 判断是不是判错了全靠它', async () => {
    mockTimeline([touch({ summary: '客户说别再打给我了', outcome: 'do_not_contact' })])
    draw()
    await waitFor(() => expect(screen.getByText('客户说别再打给我了')).toBeTruthy())
  })

  it('🔓 有人判错解了闸，也要看得见（否则销售不知道现在到底能不能联系）', async () => {
    mockTimeline([touch({ summary: '这条判错了', outcome: 'dnc_cleared' })])
    draw()
    await waitFor(() => expect(screen.getByText(/放回了名单/)).toBeTruthy())
  })

  /**
   * 🔴 **外呼那条路不写 `outcome: 'do_not_contact'`**（Codex 复审 PR #1048，
   * 2026-08-17）。`lib/voice/crm-bridge.ts` 写的是
   * `outcome: 'not_interested'` **加上** `metadata.do_not_contact: true`，
   * 而 `isDoNotContact` 认后者 —— 这个人是**全渠道被停**的。
   *
   * 只看 `outcome` 的话，销售看到的只有一句「他说不买了」，
   * 完全不知道系统已经把所有渠道关了 —— 正是这个功能声称要消灭的那种「看不见」。
   */
  it('🔴 电话里说别再打了（outcome 是 not_interested + 停联标记）→ 照样显示上闸', async () => {
    mockTimeline([
      touch({ summary: '外呼：客人说别再打了', outcome: 'not_interested', dncFlag: true }),
    ])
    draw()
    await waitFor(() =>
      expect(screen.getByText(/电话 \/ 邮件 \/ 私信全都不再发给他/)).toBeTruthy(),
    )
  })

  it('普通的「他说不买了」没有停联标记 → 不显示上闸（别把不买当成拒联）', async () => {
    // summary 不能跟结论小标签同字，否则 getByText 命中两个元素、报的是歧义不是真失败
    mockTimeline([touch({ summary: '聊完他决定不去了', outcome: 'not_interested' })])
    draw()
    await waitFor(() => expect(screen.getByText('聊完他决定不去了')).toBeTruthy())
    expect(screen.queryByText(/全都不再发给他/)).toBeNull()
  })

  /**
   * 人纠正过「判错了」时，那条纠正触点本身可能也带着停联标记的残留。
   * 判据只有一份：`dnc_cleared` 是对上一次判决的**推翻**，优先级最高。
   */
  it('🔴 解闸那条即使带着停联标记，也要显示成解闸而不是上闸', async () => {
    mockTimeline([touch({ summary: '这条判错了', outcome: 'dnc_cleared', dncFlag: true })])
    draw()
    await waitFor(() => expect(screen.getByText(/放回了名单/)).toBeTruthy())
    expect(screen.queryByText(/全都不再发给他/)).toBeNull()
  })
})

describe('其余结论只挑影响下一步动作的', () => {
  it('打不通 / 没人接 / 不买了 显示成人话', async () => {
    mockTimeline([
      touch({ summary: 'a', outcome: 'bad_number' }),
      touch({ summary: 'b', outcome: 'no_answer' }),
      touch({ summary: 'c', outcome: 'not_interested' }),
    ])
    draw()
    await waitFor(() => expect(screen.getByText('这个号打不通')).toBeTruthy())
    expect(screen.getByText('打了没人接')).toBeTruthy()
    expect(screen.getByText('他说不买了')).toBeTruthy()
  })

  it('客人打来我们没接到（missed_inbound）显示成人话', async () => {
    mockTimeline([touch({ summary: 'c', outcome: 'missed_inbound' })])
    draw()
    await waitFor(() => expect(screen.getByText('他打来我们没接到')).toBeTruthy())
  })

  /**
   * `spoke` 是**兜底值** —— 任何没命中规则的普通备注都会落成它
   * （见 `note-parser` 的 `classifyNote` 结尾）。标出来等于满屏噪音，
   * 而噪音会把上面那条真正的「闸」一起淹掉。
   */
  it('🔴 兜底值 spoke 不显示 —— 否则满屏噪音会淹掉真正的闸', async () => {
    mockTimeline([touch({ summary: '随便聊了聊', outcome: 'spoke' })])
    draw()
    await waitFor(() => expect(screen.getByText('随便聊了聊')).toBeTruthy())
    expect(screen.queryByText(/聊过/)).toBeNull()
  })
})

/**
 * 「他是从哪来的」这一行的价值全在**可信**。说错了还不如不说 ——
 * 销售会照着一个错的来源定开场白。所以两道闸：必须是客人来的、渠道必须认得出。
 * （Codex 复审 PR #1038，2026-08-17）
 */
describe('他是从哪来的', () => {
  it('客人填了表单 → 显示来源', async () => {
    mockTimeline([
      touch({ channel: 'meta_lead_form', direction: 'inbound', summary: '填了表单' }),
      touch({ at: '2026-08-12T00:00:00Z', summary: '回访' }),
    ])
    draw()
    await waitFor(() => expect(screen.getByText('Facebook 表单')).toBeTruthy())
  })

  it('客人主动发的私信 → 按对话真实渠道显示', async () => {
    mockTimeline([
      {
        kind: 'message',
        at: '2026-08-10T00:00:00Z',
        direction: 'inbound',
        body: '你好',
        channel: 'messenger',
      },
    ])
    draw()
    await waitFor(() => expect(screen.getByText('私信')).toBeTruthy())
  })

  /**
   * 🔴 第一条是**我们打出去**的电话时，那说明的是「我们怎么找到他的」，
   * 不是「他从哪来的」。初版会照样写「他是从电话来的」。
   */
  it('🔴 第一条是我们打出去的 → 整行不显示', async () => {
    mockTimeline([touch({ channel: 'phone', direction: 'outbound', summary: '我们打过去' })])
    draw()
    await waitFor(() => expect(screen.getByText('我们打过去')).toBeTruthy())
    expect(screen.queryByText(/他是从/)).toBeNull()
  })

  /**
   * 🔴 对话表里还有 email / whatsapp / voice。初版把所有消息硬编码成「私信」。
   * 渠道认不出来时宁可不说。
   */
  it('🔴 消息没带渠道 → 不猜，整行不显示', async () => {
    mockTimeline([
      { kind: 'message', at: '2026-08-10T00:00:00Z', direction: 'inbound', body: '你好' },
    ])
    draw()
    await waitFor(() => expect(screen.getByText('你好')).toBeTruthy())
    expect(screen.queryByText(/他是从/)).toBeNull()
  })

  /**
   * 🔴 渠道**有值但我们不认识**（对话表里有 `voice`，中文对照表里没有）时，
   * 不能把英文 key 直接甩给销售看 —— 那既不是人话，也可能根本不是获客来源。
   * 这一条跟上面「没带渠道」不是同一种情况：那条 `channel` 是空的，
   * 兜底成 `channel` 本身也还是空；这条才真的分得出两种写法。
   */
  it('🔴 渠道认得出才说 —— 不认识的英文 key 不甩给销售', async () => {
    mockTimeline([
      {
        kind: 'message',
        at: '2026-08-10T00:00:00Z',
        direction: 'inbound',
        body: '你好',
        channel: 'voice',
      },
    ])
    draw()
    await waitFor(() => expect(screen.getByText('你好')).toBeTruthy())
    expect(screen.queryByText(/他是从/)).toBeNull()
  })

  it('没有往来记录时不炸', async () => {
    mockTimeline([])
    draw()
    await waitFor(() => expect(screen.getByText('还没有往来记录。')).toBeTruthy())
  })
})

/**
 * 🔴 判决旁边必须是**销售真正敲的那句话**，不是 AI 摘要
 * （Codex 复审 PR #1038，2026-08-17）。
 *
 * `recordManualTouchpoint` 把 AI 摘要存进 `summary`、原话存进 `raw`。
 * 「暂时不去」和「别再联系我」摘要之后可能长得一样，判决却天差地别 ——
 * 拿摘要去复核一个全渠道封锁，等于没复核。
 */
describe('判决旁边的是原话，不是 AI 摘要', () => {
  it('🔴 原话跟摘要不同时，原话要显示出来', async () => {
    mockTimeline([
      touch({
        summary: '客户表示不再需要跟进',
        raw: '这次不去了，明年再说吧，你们别老打了',
        outcome: 'do_not_contact',
      }),
    ])
    draw()
    await waitFor(() =>
      expect(screen.getByText(/这次不去了，明年再说吧/)).toBeTruthy(),
    )
  })

  it('原话跟摘要一样就不重复铺一遍', async () => {
    mockTimeline([touch({ summary: '别再联系我', raw: '别再联系我', outcome: 'do_not_contact' })])
    draw()
    await waitFor(() => expect(screen.getAllByText('别再联系我')).toHaveLength(1))
  })

  /**
   * 🔴 **不是所有 `raw` 都是逐字原话**（Codex 复审 PR #1048，2026-08-17）。
   * 外呼那条路写的是 `raw: call.summary`，而那是**模型生成**的通话摘要
   * （`voice/finalize.ts` 拼的 `Caller discussed: …`）。标成「原话」，
   * 销售会以为自己在看客人说的话，然后据此决定要不要解除全渠道停联。
   */
  it('🔴 外呼记录的 raw 是 AI 摘要 → 必须标明，不能叫「原话」', async () => {
    mockTimeline([
      touch({
        summary: '外呼 · 已接通',
        raw: 'Caller discussed: tours. Next: send quote.',
        rawKind: 'ai_summary',
        outcome: 'not_interested',
        dncFlag: true,
      }),
    ])
    draw()
    await waitFor(() => expect(screen.getByText(/通话摘要（AI 整理，非逐字原话）/)).toBeTruthy())
    expect(screen.queryByText(/^原话：/)).toBeNull()
  })

  it('手工记录 / 邮件那种才叫原话', async () => {
    mockTimeline([
      touch({ summary: '摘要', raw: '客户说别再打了', rawKind: 'verbatim', outcome: 'do_not_contact' }),
    ])
    draw()
    await waitFor(() => expect(screen.getByText(/原话：/)).toBeTruthy())
    expect(screen.queryByText(/AI 整理/)).toBeNull()
  })

  it('普通记录不铺原话 —— 摘要更短更好读', async () => {
    mockTimeline([touch({ summary: '聊了两句', raw: '客人问了价格然后说再想想', outcome: 'spoke' })])
    draw()
    await waitFor(() => expect(screen.getByText('聊了两句')).toBeTruthy())
    expect(screen.queryByText(/客人问了价格/)).toBeNull()
  })
})

/**
 * 记录一多就框起来并停在最新那条 —— 微信 / WhatsApp 打开都停在最新一句，
 * 我们原先停在最早一句，销售每天白滚几十次（PM 2026-08-17，CTS 销售视角）。
 */
describe('记录多的时候停在最新一条', () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      touch({ at: `2026-08-${String(i + 1).padStart(2, '0')}T00:00:00Z`, summary: `第 ${i} 条` }),
    )

  it('记录少 → 不框，整条铺开', async () => {
    mockTimeline(many(3))
    draw()
    await waitFor(() => expect(screen.getByText('第 0 条')).toBeTruthy())
    expect(screen.getByTestId('timeline-list').className).not.toContain('overflow-y-auto')
  })

  /**
   * jsdom 不做排版，`scrollHeight` 恒为 0 —— 直接断言 `scrollTop === scrollHeight`
   * 会**永远通过**，那是个假测试。所以先把 `scrollHeight` 假装成有内容的高度，
   * 再看代码有没有真的把它滚下去。
   */
  it('🔴 记录多 → 框起来，并且滚到底（不是停在三个月前那条）', async () => {
    const spy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockReturnValue(2000)
    try {
      mockTimeline(many(12))
      draw()
      const list = await waitFor(() => screen.getByTestId('timeline-list'))
      expect(list.className).toContain('overflow-y-auto')
      await waitFor(() => expect(list.scrollTop).toBe(2000))
    } finally {
      spy.mockRestore()
    }
  })

  /**
   * 🔴 来源那一行必须在滚动区**外面**（Codex 复审 PR #1038，2026-08-17）。
   *
   * 它原先是滚动容器的第一个子元素，而容器一打开就被滚到底 —— 记录多的人
   * 一进来这行就被顶出可视区。而记录多的人恰恰最需要知道来源（历史越长越
   * 记不清他哪来的）。两个改动互相抵消，等于两个都白做。
   */
  it('🔴 来源那一行不在滚动区里 —— 否则一滚到底就看不见了', async () => {
    mockTimeline([
      touch({ channel: 'meta_lead_form', direction: 'inbound', summary: '填了表单' }),
      ...many(11),
    ])
    draw()
    const origin = await waitFor(() => screen.getByText('Facebook 表单'))
    const list = screen.getByTestId('timeline-list')
    expect(list.className).toContain('overflow-y-auto')
    expect(list.contains(origin)).toBe(false)
  })

  it('记录少 → 不去动滚动位置', async () => {
    const spy = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(2000)
    try {
      mockTimeline(many(3))
      draw()
      const list = await waitFor(() => screen.getByTestId('timeline-list'))
      expect(list.scrollTop).toBe(0)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('摘要回传给抽屉', () => {
  it('把最后一句话和想去哪交出去 —— 抽屉顶上那张卡靠它', async () => {
    mockTimeline([
      touch({ summary: '问了南岛', tour: '南岛 8 日' }),
      touch({ at: '2026-08-12T00:00:00Z', direction: 'inbound', summary: '想三月走' , travelWindow: '三月' }),
    ])
    const onSummary = vi.fn()
    render(<ContactTimeline clientId="cts" contactId="c1" onSummary={onSummary} />)
    await waitFor(() => expect(onSummary).toHaveBeenCalled())
    const s = onSummary.mock.calls.at(-1)?.[0]
    expect(s.lastText).toBe('想三月走')
    expect(s.lastWho).toBe('客人')
    // 越新的越算数：两条记录各带一个字段，都要留下
    expect(s.tour).toBe('南岛 8 日')
    expect(s.travelWindow).toBe('三月')
  })

  /**
   * 🔴 **旧请求的结果一律丢掉**（Codex 复审 PR #1038 第三轮，2026-08-17）。
   *
   * 抽屉刚打开、第一次请求还没回来时，销售可以立刻点「没打通」。写成功之后
   * 抽屉会换掉 `key` —— **整个组件被换掉**。旧实例那次请求仍在路上，回来得晚
   * 就会把**写入之前**的摘要盖回去：顶上那张卡说的是记这一笔之前的话，
   * 下面的记录却是新的。两边打架，而销售没办法看出哪边是真的。
   *
   * 光在实例内部记「第几次请求」不够 —— 旧实例是另一个实例，有自己的计数器。
   * 闸必须是「这个实例还活着吗」。这条用例就是卸载之后再放行响应。
   */
  it('🔴 组件已经被换掉之后，旧请求的结果不许再回调', async () => {
    let release: (v: unknown) => void = () => {}
    global.fetch = vi.fn().mockReturnValue(
      new Promise((r) => {
        release = r
      }),
    ) as unknown as typeof fetch

    const onSummary = vi.fn()
    const { unmount } = render(
      <ContactTimeline clientId="cts" contactId="c1" onSummary={onSummary} />,
    )
    // 请求还在路上就把这个实例换掉（= 抽屉换 key）
    unmount()
    // 旧请求这时候才回来
    release({
      ok: true,
      json: async () => ({
        contact: { name: 'Sue', phone: null, email: null, stageLabel: null },
        timeline: [touch({ summary: '这是写入之前的旧数据' })],
      }),
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(onSummary).not.toHaveBeenCalled()
  })

  it('🔴 拉失败时把摘要清掉 —— 顶上留着上一个人的话比空着危险', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: '炸了' }),
    }) as unknown as typeof fetch
    const onSummary = vi.fn()
    render(<ContactTimeline clientId="cts" contactId="c1" onSummary={onSummary} />)
    await waitFor(() => expect(onSummary).toHaveBeenCalledWith(null))
  })
})

/**
 * 意向卡已经并进抽屉顶部那张「该做什么」卡（PM 2026-10-10：页面少信息多引导，
 * 只留一个概念告诉人该做什么）。时间线自己不再画意向标签 / 摘要卡 ——
 * 接口就算还回着 `brief`，这里也不该冒出第二张卡跟抽屉顶上那张打架。
 */
describe('意向卡已并进抽屉顶部那一张「该做什么」卡 —— 时间线自己不再画', () => {
  it('接口就算回了 brief，时间线里也没有意向标签 / 摘要卡', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        contact: { name: 'Sue', phone: null, email: null, stageLabel: null },
        timeline: [touch()],
        brief: { intentLevel: 'high', summary: '客人已确认合作', nextAction: '发最终账单' },
      }),
    }) as unknown as typeof fetch
    draw()
    await waitFor(() => expect(screen.getByText('打过去聊了两句')).toBeTruthy())
    expect(screen.queryByText('高意向')).toBeNull()
    expect(screen.queryByTestId('timeline-brief')).toBeNull()
  })
})

/**
 * 「到哪一步了」是谁判的 —— 从最新一条阶段变更的 `changedBy` 推断，回传给抽屉。
 *
 * 判据只有一份（`stageSourceOf`），抽屉顶上那张卡靠它决定要不要标「人工标的」。
 * 认不出的机器身份返回 null —— 宁可不显示，不许说错。
 */
describe('到哪一步了是谁判的（stageSource）', () => {
  const stage = (over: Partial<TimelineEntry> = {}): TimelineEntry => ({
    kind: 'stage',
    at: '2026-09-01T00:00:00Z',
    fromLabel: null,
    toLabel: '已报价',
    changedBy: 'ai:conversation-read',
    ...over,
  })

  const summaryOf = async (timeline: TimelineEntry[]) => {
    mockTimeline(timeline)
    const onSummary = vi.fn()
    render(<ContactTimeline clientId="cts" contactId="c1" onSummary={onSummary} />)
    await waitFor(() => expect(onSummary).toHaveBeenCalled())
    return onSummary.mock.calls.at(-1)?.[0]
  }

  it('AI 从对话里读的 → ai_conversation', async () => {
    const s = await summaryOf([stage(), touch()])
    expect(s).toEqual(expect.objectContaining({ stageSource: 'ai_conversation' }))
  })

  it('同事的邮箱 → human', async () => {
    const s = await summaryOf([stage({ changedBy: 'info@example.co.nz' }), touch()])
    expect(s).toEqual(expect.objectContaining({ stageSource: 'human' }))
  })

  it('🔴 认不出的机器身份 → null（宁可不显示，不许说错）', async () => {
    const s = await summaryOf([stage({ changedBy: 'system:qualified-buyer' }), touch()])
    expect(s).toEqual(expect.objectContaining({ stageSource: null }))
  })

  it('🔴 多条阶段变更 → 最新的那条算数', async () => {
    const s = await summaryOf([
      stage({ at: '2026-08-01T00:00:00Z', changedBy: 'info@example.co.nz' }),
      stage({ at: '2026-09-01T00:00:00Z', changedBy: 'ai:conversation-read' }),
      touch(),
    ])
    expect(s).toEqual(expect.objectContaining({ stageSource: 'ai_conversation' }))
  })

  it('没有任何阶段变更 → null', async () => {
    const s = await summaryOf([touch()])
    expect(s).toEqual(expect.objectContaining({ stageSource: null }))
  })

  it('stageSourceOf 直接判：订单系统 / 空值', () => {
    expect(stageSourceOf('order-system')).toBe('order_system')
    expect(stageSourceOf('')).toBeNull()
  })
})

describe('刚拨出、整理中的电话 —— 页面要立刻看得出「打过了」', () => {
  it('通话中 / 已挂断整理中各有自己的标签和说明', async () => {
    mockTimeline([
      touch({ pendingCall: 'ringing', summary: '正在通话中…（挂断后这里会自动整理成记录）' }),
      touch({ at: '2026-08-10T00:05:00Z', pendingCall: 'ended', summary: '刚拨出的电话已结束，正在整理成记录（约 2 分钟，不用等，可以直接去下一位）' }),
    ])
    draw()
    await waitFor(() => expect(screen.getAllByTestId('pending-call')).toHaveLength(2))
    expect(screen.getByText(/通话中$/)).toBeTruthy()
    expect(screen.getByText(/已挂断，整理中/)).toBeTruthy()
    expect(screen.getByText(/可以直接去下一位/)).toBeTruthy()
  })

  it('点过拨打后自动刷新：整理中的电话变成正式记录，列表不闪成「加载中」', async () => {
    vi.useFakeTimers()
    try {
      const first = [touch({ pendingCall: 'ended', summary: '刚拨出的电话已结束，正在整理成记录（约 2 分钟，不用等，可以直接去下一位）' })]
      const second = [touch({ summary: '外呼，通话 43 秒' })]
      let n = 0
      global.fetch = vi.fn().mockImplementation(async () => ({
        ok: true,
        json: async () => ({ contact: { name: 'Sue', phone: null, email: null, stageLabel: null }, timeline: n++ === 0 ? first : second }),
      })) as unknown as typeof fetch
      render(<ContactTimeline clientId="cts" contactId="c1" dialedAt={Date.now()} />)
      await act(async () => { await vi.advanceTimersByTimeAsync(50) })
      expect(screen.getAllByTestId('pending-call')).toHaveLength(1)
      await act(async () => { await vi.advanceTimersByTimeAsync(8_100) })
      expect(screen.queryByText('加载往来记录…')).toBeNull()
      expect(screen.queryAllByTestId('pending-call')).toHaveLength(0)
      expect(screen.getByText('外呼，通话 43 秒')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('没点过拨打、也没有整理中的电话：不自动刷新', async () => {
    vi.useFakeTimers()
    try {
      mockTimeline([touch({ summary: '打过去聊了两句' })])
      render(<ContactTimeline clientId="cts" contactId="c1" />)
      await act(async () => { await vi.advanceTimersByTimeAsync(50) })
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
      expect((global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('可折叠：默认收起，点开才铺原文（客人抽屉用）', () => {
  const drawCollapsible = (props: { refreshKey?: number } = {}) =>
    render(<ContactTimeline clientId="cts" contactId="c1" collapsible {...props} />)

  const many = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      touch({ summary: `第${i + 1}通电话`, at: `2026-08-${String(10 + i).padStart(2, '0')}T00:00:00Z` }),
    )

  it('条数不多：最近几条直接露出，按钮仍写「看完整往来原文（N 条）」', async () => {
    mockTimeline([touch({ summary: '第一通电话' }), touch({ summary: '第二通电话', at: '2026-08-11T00:00:00Z' })])
    drawCollapsible()
    await waitFor(() => expect(screen.getByText(/看完整往来原文（2 条）/)).toBeTruthy())
    expect(screen.getByText('第一通电话')).toBeTruthy()
  })

  it('条数多：只露最近 5 条，更早的折起来，按钮写还有几条', async () => {
    mockTimeline(many(7))
    drawCollapsible()
    await waitFor(() => expect(screen.getByText(/看更早的往来（还有 2 条）/)).toBeTruthy())
    expect(screen.getByText('第7通电话')).toBeTruthy()
    expect(screen.getByText('第3通电话')).toBeTruthy()
    expect(screen.queryByText('第2通电话')).toBeNull()
  })

  it('点开铺出全部，再点「收起往来原文」回到只露最近 5 条', async () => {
    mockTimeline(many(7))
    drawCollapsible()
    fireEvent.click(await screen.findByText(/看更早的往来/))
    expect(screen.getByText('第1通电话')).toBeTruthy()
    fireEvent.click(screen.getByText(/收起往来原文/))
    expect(screen.queryByText('第1通电话')).toBeNull()
    expect(screen.getByText(/看更早的往来/)).toBeTruthy()
  })

  it('🔴 展开后 refreshKey 变了（回了一条消息）→ 重新取数，且仍保持展开', async () => {
    mockTimeline([touch({ summary: '旧的一条' })])
    const view = drawCollapsible({ refreshKey: 0 })
    fireEvent.click(await screen.findByText(/看完整往来原文/))
    expect(screen.getByText('旧的一条')).toBeTruthy()

    // 发完消息后服务端多了一条
    mockTimeline([touch({ summary: '旧的一条' }), touch({ summary: '刚发的一条', at: '2026-08-12T00:00:00Z' })])
    view.rerender(<ContactTimeline clientId="cts" contactId="c1" collapsible refreshKey={1} />)

    await waitFor(() => expect(screen.getByText('刚发的一条')).toBeTruthy())
    // 没缩回折叠按钮那一行
    expect(screen.queryByText(/看完整往来原文|看更早的往来/)).toBeNull()
  })

  it('不传 collapsible → 照旧整条铺开（其它页面不受影响）', async () => {
    mockTimeline([touch({ summary: '直接铺开' })])
    draw()
    await waitFor(() => expect(screen.getByText('直接铺开')).toBeTruthy())
    expect(screen.queryByText(/看完整往来原文/)).toBeNull()
  })
})

describe('机器自动发出的邮件（Mailchimp 欢迎信 / 群发）', () => {
  it('在时间线里标成「系统自动发出」', async () => {
    mockTimeline([
      touch({ channel: 'email', direction: 'outbound', summary: '发出《Welcome to CTS》', automated: true }),
    ])
    draw()
    await waitFor(() => expect(screen.getByText(/系统自动发出/)).toBeTruthy())
    expect(screen.getByText(/发出《Welcome to CTS》/)).toBeTruthy()
  })

  it('不算「最后一句」：不会盖掉客人真说的话', async () => {
    mockTimeline([
      touch({ channel: 'email', direction: 'inbound', at: '2026-10-28T01:00:00Z', summary: 'Price for 2 please?' }),
      touch({ channel: 'email', direction: 'outbound', at: '2026-10-28T19:00:00Z', summary: '发出《Welcome to CTS》', automated: true }),
    ])
    const onSummary = vi.fn()
    render(<ContactTimeline clientId="cts" contactId="c1" onSummary={onSummary} />)
    await waitFor(() => expect(onSummary).toHaveBeenCalled())
    // 抽屉顶上的「最后一句」交出去的是客人的话，不是那封自动信
    const s = onSummary.mock.calls.at(-1)?.[0]
    expect(s.lastText).toBe('Price for 2 please?')
    expect(s.lastWho).toBe('客人')
  })
})
