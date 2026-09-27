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

beforeEach(() => vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })))
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
    const note = document.querySelector('textarea')
    const due = document.querySelector('input[type="date"]') as HTMLInputElement | null
    expect(note?.value).toBe('等她确认出发日期')
    // 到期日要带出来 —— 显示成空白会让人以为没设过，然后覆盖掉别人设的
    expect(due?.value).toBe('2026-10-03')
  })

  it('没设过提醒时这一格照样在，不是整块不见', () => {
    drawFor('cts', { important: null })
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
    fireEvent.click(btn('现在')!)
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
    fireEvent.click(btn('现在')!)
    fireEvent.click(btn('已联系')!)
    expect(document.body.textContent ?? '').not.toContain('这笔生意多少钱')
  })

  it('CTS 点同一档「已成交」→ 不该弹录金额（那是 NAL 专属通道）', () => {
    drawFor('cts', {}, [{ stageKey: 'won', label: '已成交', marketingAction: 'won' }])
    fireEvent.click(btn('现在')!)
    fireEvent.click(btn('已成交')!)
    expect(document.body.textContent ?? '').not.toContain('这笔生意多少钱')
  })
})
