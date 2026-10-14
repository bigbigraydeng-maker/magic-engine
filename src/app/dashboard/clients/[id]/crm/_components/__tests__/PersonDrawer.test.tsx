/**
 * 抽屉里的联系方式。
 *
 * 🔴 **抽屉必须跟卡片说同一件事**（Codex 复审 2026-08-16）。
 *
 * 号码打不通的人只要还有邮箱或 Messenger，就会留在名单上（见
 * `lib/crm/segments` 的「号码打不通 ≠ 这个人不要了」）。卡片已经把拨号动作换成
 * 一句「这个号打不通」；但抽屉原先只看有没有号码就无条件渲染一个 `tel:` 链接
 * —— 销售点开卡片，照样一点就拨那个**已知打不通**的号。
 *
 * 一半修好一半没修，比两半都没修更危险：他会以为卡片上那句提醒是过时的。
 */

import React from 'react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PersonDrawer, type DrawerRow } from '../PersonDrawer'

const row = (over: Partial<DrawerRow> = {}): DrawerRow => ({
  contactId: 'c1',
  name: 'Sue Masson',
  phone: '+64211234567',
  email: 'sue@example.com',
  stage: null,
  stageLabel: null,
  ...over,
})

const draw = (over: Partial<DrawerRow> = {}) =>
  render(
    <PersonDrawer
      clientId="cts"
      row={row(over)}
      stages={[]}
      viewerEmail="fde@example.com"
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  )

// timeline: [] —— PersonDrawer 内嵌的 ContactTimeline 会拿同一个 fetch 桩去请求往来记录，
// 不给这个字段它会在 data.timeline.length 上抛出（魏征 2026-09-28 复审 B2 时点出：
// 不影响断言通过，但会在每条用例后面留一串无关的 Uncaught Exception 噪音）。
beforeEach(() =>
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ timeline: [], omittedMessages: 0 }) })),
)
afterEach(() => vi.unstubAllGlobals())

/** 号码是不是被做成了可以点的拨号链接。 */
const dialLink = () =>
  Array.from(document.querySelectorAll('a')).find((a) => a.getAttribute('href')?.startsWith('tel:'))

describe('号码打不通的人，抽屉里不许还能一点就拨', () => {
  it('打不通 → 没有拨号链接', () => {
    draw({ phoneUnusable: true })
    expect(dialLink()).toBeUndefined()
  })

  it('号码本身还得看得见 —— 要改号先得知道原来是什么', () => {
    draw({ phoneUnusable: true })
    expect(screen.getByText(/\+64211234567/)).toBeTruthy()
  })

  it('说清该做什么，别只是把按钮拿掉', () => {
    draw({ phoneUnusable: true })
    expect(screen.getByText(/这个号打不通/)).toBeTruthy()
    expect(screen.getByText(/要个新号/)).toBeTruthy()
  })

  it('邮箱照旧能点 —— 这正是他还留在名单上的原因', () => {
    draw({ phoneUnusable: true })
    const mail = Array.from(document.querySelectorAll('a')).find((a) =>
      a.getAttribute('href')?.startsWith('mailto:'),
    )
    expect(mail).toBeTruthy()
  })
})

describe('号码好好的人，一个字都不该变', () => {
  it('照旧是可以点的拨号链接', () => {
    draw()
    expect(dialLink()?.getAttribute('href')).toBe('tel:+64211234567')
  })

  it('不出现那句「打不通」的提醒', () => {
    draw()
    expect(screen.queryByText(/这个号打不通/)).toBeNull()
  })
})

/**
 * R1（2026-09-27）：两页的「点开一个人」各缺一半，这一轮把抽屉补成超集。
 *
 * 🔴 缺的那两样都不是可选项：
 * · 「要记住的事」—— 今日待办有一条 `crm_important_due` 直接依赖它。抽屉里没有，
 *   销售在「今天要联系」页上就设不了提醒，得跳到另一页去设。
 * · NAL 的「确认已成交」—— 标成交要先录金额再回传广告转化。抽屉里没有，
 *   同一个客人在一页能标、另一页标不了。
 *
 * `DncBanner.tsx` 的头注就是这个分裂的事故记录：「FDE 照着人工任务点进去，
 * 页面上根本没有任务里说的那个按钮」。
 */
/** 按钮文字里含某几个字的那个按钮 —— 比 getByText 稳：文案里混着变量，别让查询方式决定测试成不成。 */
const btn = (contains: string): HTMLButtonElement | undefined =>
  Array.from(document.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes(contains))

/**
 * 次要控件（没打通 / 改到哪一步 / 要记住的事）都收在「更多」里 —— 屏幕上只留一个主按钮
 * （PM 2026-10-10：按钮太多，说了两遍）。要点它们先展开。
 */
const openMore = () => fireEvent.click(btn('更多')!)
const openStagePanel = () => {
  openMore()
  fireEvent.click(btn('改「到哪一步了」')!)
}

describe('R1 · 抽屉补齐「全部客人」那边独有的两样', () => {
  const NAL = '4ae76381-cd45-43bd-85cd-98cfd7604007'

  const drawFor = (
    clientId: string,
    over: Partial<DrawerRow> = {},
    stages: Array<{ stageKey: string; label: string; marketingAction?: string; isTerminal?: boolean }> = [],
  ) =>
    render(
      <PersonDrawer
        clientId={clientId}
        row={row(over)}
        stages={stages}
        viewerEmail="fde@example.com"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    )

  it('「要记住的事」出现在抽屉里，已存的提醒和到期日都显示出来', () => {
    drawFor('cts', { important: { note: '等她确认出发日期', dueAt: '2026-10-03T12:00:00Z' } })
    openMore()
    const note = document.querySelector('textarea')
    const due = document.querySelector('input[type="date"]') as HTMLInputElement | null
    expect(note?.value).toBe('等她确认出发日期')
    // 到期日要带出来 —— 显示成空白会让人以为没设过，然后覆盖掉别人设的
    expect(due?.value).toBe('2026-10-03')
  })

  it('没设过提醒时这一格照样在，不是整块不见', () => {
    drawFor('cts', { important: null })
    openMore()
    expect(document.querySelector('textarea')).toBeTruthy()
    expect(document.querySelector('input[type="date"]')).toBeTruthy()
  })

  /**
   * 🔴 判据必须跟「全部客人」那一页一模一样：**只有 NAL + 那一档营销动作是 won**。
   * 两个方向都有代价：漏了 → NAL 标成交不录金额、广告转化回传不了；
   * 过宽 → CTS 标成交时冒出一个它根本不该走的录金额面板（CTS 走 Google 表格那条）。
   */
  /**
   * 🔴 这两条**刻意不用 `waitFor`**：点「已成交」只改本地 state，面板是同步就渲染出来的
   * （实测点完那一刻 `document.body.textContent` 里已经有金额提示了）。
   * 而在这个文件里套 `waitFor` 会让 body 变空 —— 等一件已经发生的事，只会把它等没了。
   */
  it('NAL 点「已成交」→ 先弹录金额，不直接改阶段', () => {
    drawFor(NAL, {}, [{ stageKey: 'won', label: '已成交', marketingAction: 'won' }])
    openStagePanel()
    fireEvent.click(btn('已成交')!)
    const body = document.body.textContent ?? ''
    expect(body).toContain('这笔生意多少钱')
    expect(body).toContain('确认已成交')
  })

  /**
   * 🔴 判据是**两个条件都要满足**：是 NAL + 这一档的营销动作是「成交」。
   *
   * 少了后半个条件，NAL 标「已联系」也会弹录金额 —— 员工填个数字进去，
   * 系统就往广告平台回传一笔**根本没发生的成交**，广告优化会照着假数据去找人。
   * 变异实测：把 `s.marketingAction === 'won'` 那半去掉，原来那几条测试全绿（存活），
   * 因为它们只点成交那一档。这一条专门钉后半个条件。
   */
  it('NAL 点的不是成交档（比如「已联系」）→ 不许弹录金额', () => {
    drawFor(NAL, {}, [{ stageKey: 'contacted', label: '已联系', marketingAction: 'nurture' }])
    openStagePanel()
    fireEvent.click(btn('已联系')!)
    expect(document.body.textContent ?? '').not.toContain('这笔生意多少钱')
  })

  it('CTS 点同一档「已成交」→ 不该弹录金额（那是 NAL 专属通道）', () => {
    drawFor('cts', {}, [{ stageKey: 'won', label: '已成交', marketingAction: 'won' }])
    openStagePanel()
    fireEvent.click(btn('已成交')!)
    expect(document.body.textContent ?? '').not.toContain('这笔生意多少钱')
  })
})

/**
 * B2（2026-09-28）：「全部客人」页换用 PersonDrawer 之后加的「上一位/下一位」。
 * `nav` 不传就不渲染 —— 「今天要联系」页暂不需要这个（魏征复审：不能含糊带过，
 * 这里锁住两种状态各自的行为）。
 */
describe('B2 · 上一位/下一位（nav 可选）', () => {
  it('不传 nav → 不渲染上一位/下一位这一行', () => {
    draw()
    expect(btn('上一位')).toBeUndefined()
    expect(btn('下一位')).toBeUndefined()
  })

  it('传了 nav → 渲染 positionLabel，点按钮调用对应的回调', () => {
    const onPrev = vi.fn()
    const onNext = vi.fn()
    render(
      <PersonDrawer
        clientId="cts"
        row={row()}
        stages={[]}
        viewerEmail="fde@example.com"
        onClose={vi.fn()}
        onSaved={vi.fn()}
        nav={{ positionLabel: '客人在等你 · 第 3 位 / 共 20 位', onPrev, onNext, busy: false }}
      />,
    )
    expect(screen.getByText('客人在等你 · 第 3 位 / 共 20 位')).toBeTruthy()
    fireEvent.click(btn('上一位')!)
    expect(onPrev).toHaveBeenCalledOnce()
    fireEvent.click(btn('下一位')!)
    expect(onNext).toHaveBeenCalledOnce()
  })

  it('busy:true → 两个按钮都禁用，显示"正在拿下一位"而不是位置文案', () => {
    render(
      <PersonDrawer
        clientId="cts"
        row={row()}
        stages={[]}
        viewerEmail="fde@example.com"
        onClose={vi.fn()}
        onSaved={vi.fn()}
        nav={{ positionLabel: '客人在等你 · 第 3 位 / 共 20 位', onPrev: vi.fn(), onNext: vi.fn(), busy: true }}
      />,
    )
    expect(screen.getByText('正在拿下一位…')).toBeTruthy()
    expect(btn('上一位')?.disabled).toBe(true)
    expect(btn('下一位')?.disabled).toBe(true)
  })
})

/**
 * 「该做什么」卡（PM 2026-10-10）：三行 —— 动作 + 为什么 / AI 建议 / 到哪一步了。
 * 这一块取代了原来并排的三套状态（阶段按钮、冷热标签、意向小圆标）。
 */
describe('该做什么卡', () => {
  it('有 nextAction → 顶部一张卡：动作 + 为什么 + AI 建议', () => {
    draw({
      nextAction: {
        list: 'hot',
        verb: 'call',
        verbLabel: '打给他',
        line: '打给他 —— 聊过一轮断了，AI 读完对话判他意向高',
        reason: '聊过一轮断了，AI 读完对话判他意向高',
        aiSuggestion: '打电话给 Tim，确认装箱单',
        intentBoost: true,
      },
    })
    expect(screen.getByTestId('next-action-card')).toBeTruthy()
    expect(screen.getByText('打给他')).toBeTruthy()
    expect(screen.getByText('聊过一轮断了，AI 读完对话判他意向高')).toBeTruthy()
    expect(screen.getByText(/打电话给 Tim/)).toBeTruthy()
  })

  it('没有 AI 建议就不画那一行', () => {
    draw({
      nextAction: {
        list: 'hot',
        verb: 'call',
        verbLabel: '打给他',
        line: '打给他 —— 聊过一轮断了，AI 读完对话判他意向高',
        reason: '聊过一轮断了，AI 读完对话判他意向高',
        aiSuggestion: null,
        intentBoost: true,
      },
    })
    expect(screen.queryByText(/AI 建议/)).toBeNull()
  })

  it('没传 nextAction（老调用方）→ 卡里只剩 reason，不炸', () => {
    draw({ reason: '客户来消息了' })
    expect(screen.getByText('客户来消息了')).toBeTruthy()
  })

  it('🔴 header 不再重复那句 reason —— 同一句话只该出现一次', () => {
    draw({
      reason: '客户来消息了，等了 18 小时',
      nextAction: {
        list: 'hot',
        verb: 'reply',
        verbLabel: '回他',
        line: '回他 —— 客户来消息了，等了 18 小时',
        reason: '客户来消息了，等了 18 小时',
        aiSuggestion: null,
        intentBoost: true,
      },
    })
    expect(screen.getAllByText('客户来消息了，等了 18 小时')).toHaveLength(1)
  })

  it('🔴 没有阶段变更记录 → 不显示「人工标的」', () => {
    render(
      <PersonDrawer
        clientId="cts"
        row={row({ stage: 'quoted', stageLabel: '已报价' })}
        stages={[{ stageKey: 'won', label: '已成交' }]}
        viewerEmail="fde@example.com"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    )
    const line = screen.getByTestId('stage-line')
    expect(line.textContent ?? '').toContain('到哪一步了：已报价')
    expect(line.textContent ?? '').not.toContain('人工标的')
  })

  it('AI 意向只当一行小字「AI 初判（未校准）」，不是圆标也不是按钮', () => {
    draw({
      intent: 'high',
      nextAction: { list: 'cold', verb: 'system_watching', verbLabel: '系统盯着', line: '系统盯着 —— 聊过一轮就断了', reason: '聊过一轮就断了', aiSuggestion: null, intentBoost: false },
    })
    expect(screen.getByText('AI 初判（未校准）：意向高')).toBeTruthy()
    expect(btn('意向')).toBeUndefined()
  })

  it('没摘要 / 判不出 → 那行小字不出现', () => {
    draw({
      intent: 'unknown',
      nextAction: { list: 'hot', verb: 'reply', verbLabel: '回他', line: '回他 —— 客户来消息了', reason: '客户来消息了', aiSuggestion: null, intentBoost: false },
    })
    expect(screen.queryByText(/AI 初判/)).toBeNull()
  })
})

describe('抽屉里的块顺序（PM 2026-10-14：先读往来记录，再回复）', () => {
  it('往来记录在回复框之前，订单与付款在往来记录之前', () => {
    render(
      <PersonDrawer
        clientId="cts"
        row={row({ segment: 'new_untouched', suggestedChannel: 'phone' })}
        stages={[{ stageKey: 'contacted', label: '已联系' }]}
        viewerEmail="fde@example.com"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    )
    const heading = screen.getByText('往来记录')
    const replies = screen.getByTestId('drawer-replies')
    // 回复框容器在往来记录标题之后（FOLLOWING = 4）
    expect(heading.compareDocumentPosition(replies) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 没有任何回复框时，容器是空的，不占位
    expect(replies.className).toContain('empty:hidden')
  })
})

describe('按钮精简（PM 2026-10-10：一屏只留一个主按钮）', () => {
  it('默认只看得到一个主按钮；「没打通」「改到哪一步」「要记住的事」都不在屏上', () => {
    render(
      <PersonDrawer
        clientId="cts"
        row={row({ segment: 'new_untouched', suggestedChannel: 'phone' })}
        stages={[{ stageKey: 'contacted', label: '已联系' }]}
        viewerEmail="fde@example.com"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    )
    expect(btn('记一笔')).toBeTruthy()
    expect(btn('没打通')).toBeUndefined()
    expect(btn('改「到哪一步了」')).toBeUndefined()
    expect(document.querySelector('textarea')).toBeNull()
    expect(screen.queryByTestId('drawer-more')).toBeNull()
  })

  it('点「更多」→ 三样都出来；再点收起', () => {
    render(
      <PersonDrawer
        clientId="cts"
        row={row({ segment: 'new_untouched', suggestedChannel: 'phone' })}
        stages={[{ stageKey: 'contacted', label: '已联系' }]}
        viewerEmail="fde@example.com"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    )
    openMore()
    expect(btn('没打通')).toBeTruthy()
    expect(btn('改「到哪一步了」')).toBeTruthy()
    expect(document.querySelector('textarea')).toBeTruthy()
    fireEvent.click(btn('收起')!)
    expect(screen.queryByTestId('drawer-more')).toBeNull()
  })
})

/**
 * B2（2026-09-28）：改阶段时带上 `expectedFromStage`，并发覆盖返回 409 时要说人话、
 * 让父级重拉（不能留着已经过时的数据装作没事）。
 */
describe('B2 · 改阶段的并发保护', () => {
  it('PATCH body 带上 expectedFromStage: row.stage', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('confirm', vi.fn(() => true))
    render(
      <PersonDrawer
        clientId="cts"
        row={row({ stage: 'new', stageLabel: '新线索' })}
        stages={[{ stageKey: 'contacted', label: '已联系' }]}
        viewerEmail="fde@example.com"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    )
    openStagePanel()
    fireEvent.click(btn('已联系')!)
    await Promise.resolve()
    await Promise.resolve()
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/stage'))
    expect(call).toBeTruthy()
    const body = JSON.parse((call![1] as RequestInit).body as string)
    expect(body).toEqual({ toStage: 'contacted', expectedFromStage: 'new' })
  })

  it('🔴 409 → onSaved 收到带阶段名字的话，reload=true，不当成一般失败', async () => {
    const onSaved = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ actualStage: 'won' }),
      }),
    )
    vi.stubGlobal('confirm', vi.fn(() => true))
    render(
      <PersonDrawer
        clientId="cts"
        row={row({ stage: 'new', stageLabel: '新线索' })}
        stages={[
          { stageKey: 'contacted', label: '已联系' },
          { stageKey: 'won', label: '已成交' },
        ]}
        viewerEmail="fde@example.com"
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    )
    openStagePanel()
    fireEvent.click(btn('已联系')!)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(onSaved).toHaveBeenCalledWith(expect.stringContaining('已成交'), true)
  })
})
