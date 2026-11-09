/**
 * 「自动发信」页面：状态切换（加载中 / 还没接通 / 出错 / 空 / 有数据）、筛选、「看这批」、
 * 示例数据的标明、抽屉（内容 / 收件人与发送情况）、演练不算已发、没有任何发信按钮。
 * 数据全是合成的示例（src/lib/crm/auto-send/demo-data.ts），这里不碰任何真实客人。
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AutoSendBoard, AutoSendWorkspace } from '../auto-send/AutoSendBoard'
import type { AutoSendAdapter } from '@/lib/crm/auto-send/adapter'
import { createDemoAdapter } from '@/lib/crm/auto-send/demo-data'

const CLIENT = 'client-123'

/** 用示例数据当「真实数据」：页面不会标示例，客人姓名会是链接。 */
async function renderReady(): Promise<void> {
  render(<AutoSendWorkspace clientId={CLIENT} liveAdapter={createDemoAdapter()} />)
  await screen.findByTestId('auto-send-next-batch')
}

function rowIds(): string[] {
  return screen.queryAllByTestId(/^letter-row-/).map((el) => el.getAttribute('data-testid') ?? '')
}

async function openLetter(letterId: string): Promise<HTMLElement> {
  const row = screen.getByTestId(`letter-row-${letterId}`)
  fireEvent.click(within(row).getByRole('button'))
  return screen.findByRole('dialog')
}

function flaky(): { adapter: AutoSendAdapter; fix: () => void } {
  let ok = false
  const demo = createDemoAdapter()
  return {
    adapter: {
      loadOverview: () => (ok ? demo.loadOverview() : Promise.reject(new Error('Failed to fetch'))),
      loadLetterDetail: (id) => (ok ? demo.loadLetterDetail(id) : Promise.reject(new Error('Failed to fetch'))),
    },
    fix: () => {
      ok = true
    },
  }
}

describe('AutoSendBoard · 还没接通 / 看示例', () => {
  it('shows the not-connected state with a 看示例 button, no letters and no demo banner', async () => {
    render(<AutoSendBoard clientId={CLIENT} />)
    expect(await screen.findByTestId('auto-send-not-connected')).toBeTruthy()
    expect(screen.queryByTestId('auto-send-demo-banner')).toBeNull()
    expect(screen.queryAllByTestId(/^letter-row-/)).toHaveLength(0)
    expect(screen.getByRole('button', { name: '看示例（假数据）' })).toBeTruthy()
  })

  it('看示例 shows the demo letters under a banner; 退出示例 goes back to not-connected', async () => {
    render(<AutoSendBoard clientId={CLIENT} />)
    fireEvent.click(await screen.findByRole('button', { name: '看示例（假数据）' }))
    expect(await screen.findByTestId('auto-send-demo-banner')).toBeTruthy()
    expect(screen.getByTestId('auto-send-demo-banner').textContent).toContain('示例数据（假的）')
    await waitFor(() => expect(rowIds().length).toBe(11))

    fireEvent.click(screen.getByRole('button', { name: '退出示例' }))
    expect(await screen.findByTestId('auto-send-not-connected')).toBeTruthy()
    expect(screen.queryByTestId('auto-send-demo-banner')).toBeNull()
    expect(rowIds()).toHaveLength(0)
  })
})

describe('AutoSendBoard · 加载中 / 出错 / 空', () => {
  it('shows 加载中… while the overview is pending', () => {
    const pending: AutoSendAdapter = {
      loadOverview: () => new Promise(() => {}),
      loadLetterDetail: () => new Promise(() => {}),
    }
    render(<AutoSendWorkspace clientId={CLIENT} liveAdapter={pending} />)
    expect(screen.getByTestId('auto-send-loading').textContent).toContain('加载中…')
  })

  it('a failed read is an error, never an empty list; English errors read 网络出错; 重试 recovers', async () => {
    const { adapter, fix } = flaky()
    render(<AutoSendWorkspace clientId={CLIENT} liveAdapter={adapter} />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('暂时读不到发信记录：网络出错')
    expect(alert.textContent).not.toContain('Failed to fetch')
    expect(screen.queryByTestId('auto-send-empty')).toBeNull()

    fix()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await screen.findByTestId('auto-send-next-batch')
    expect(rowIds().length).toBe(11)
  })

  it('shows a Chinese error message as it is', async () => {
    const adapter: AutoSendAdapter = {
      loadOverview: () => Promise.reject(new Error('服务器没有返回原因')),
      loadLetterDetail: () => Promise.reject(new Error('服务器没有返回原因')),
    }
    render(<AutoSendWorkspace clientId={CLIENT} liveAdapter={adapter} />)
    expect((await screen.findByRole('alert')).textContent).toContain('暂时读不到发信记录：服务器没有返回原因')
  })

  it('shows the empty state when there are no letters, with the next batch date when known', async () => {
    const empty: AutoSendAdapter = {
      loadOverview: () => Promise.resolve({ nextBatch: null, sections: [] }),
      loadLetterDetail: () => Promise.reject(new Error('没有')),
    }
    const { unmount } = render(<AutoSendWorkspace clientId={CLIENT} liveAdapter={empty} />)
    expect((await screen.findByTestId('auto-send-empty')).textContent).toBe('按期发送的信刷新还没有自动发信记录。')
    unmount()

    const withDate: AutoSendAdapter = {
      loadOverview: () =>
        Promise.resolve({
          nextBatch: { sendDate: '2026-12-02', letterCount: 0, recipientCount: 0, status: 'planned' },
          sections: [],
        }),
      loadLetterDetail: () => Promise.reject(new Error('没有')),
    }
    render(<AutoSendWorkspace clientId={CLIENT} liveAdapter={withDate} />)
    expect((await screen.findByTestId('auto-send-empty')).textContent).toContain('第一批会在 12月2日（周三） 发出。')
  })
})

describe('AutoSendBoard · 列表、筛选、看这批', () => {
  it('renders the next-batch card, both panels, the legend and no demo banner', async () => {
    await renderReady()
    const card = screen.getByTestId('auto-send-next-batch')
    expect(card.textContent).toContain('下一批：12月2日（周三）')
    expect(card.textContent).toContain('4 封信 · 共 21 位收件人 · 现在是草稿，发出前会请你看稿并点头')
    expect(screen.getByTestId('section-trigger')).toBeTruthy()
    expect(screen.getByTestId('section-scheduled').textContent).toContain('按期发送的信（示例：每月第一个周三；最后一个月每周三）')
    expect(screen.getByTestId('auto-send-legend').textContent).toContain('演练')
    expect(screen.queryByTestId('auto-send-demo-banner')).toBeNull()
    expect(rowIds()).toHaveLength(11)
  })

  it('filters by status; 已发 and 有被拦的 never include a rehearsal-only or draft letter', async () => {
    await renderReady()
    fireEvent.click(screen.getByRole('button', { name: '草稿' }))
    expect(rowIds()).toEqual(['letter-row-demo-l3', 'letter-row-demo-l4', 'letter-row-demo-l5'])

    fireEvent.click(screen.getByRole('button', { name: '等你放行' }))
    expect(rowIds()).toEqual(['letter-row-demo-l6'])

    fireEvent.click(screen.getByRole('button', { name: '已发' }))
    expect(rowIds()).toEqual(['letter-row-demo-l1', 'letter-row-demo-l2'])

    fireEvent.click(screen.getByRole('button', { name: '有被拦的' }))
    expect(rowIds()).toEqual(['letter-row-demo-l1', 'letter-row-demo-l2'])

    fireEvent.click(screen.getByRole('button', { name: '全部' }))
    expect(rowIds()).toHaveLength(11)
  })

  it('看这批 narrows the list to that batch without leaving the page; 看全部 restores it', async () => {
    await renderReady()
    fireEvent.click(screen.getByRole('button', { name: '看这批' }))
    expect(rowIds()).toEqual([
      'letter-row-demo-l3',
      'letter-row-demo-l4',
      'letter-row-demo-l5',
      'letter-row-demo-l6',
    ])
    expect(screen.queryByTestId('section-trigger')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '看全部' }))
    expect(rowIds()).toHaveLength(11)
    expect(screen.getByTestId('section-trigger')).toBeTruthy()
  })

  it('a filter that matches nothing says so instead of showing an empty table', async () => {
    await renderReady()
    fireEvent.click(screen.getByRole('button', { name: '看这批' }))
    fireEvent.click(screen.getByRole('button', { name: '有被拦的' }))
    expect(screen.getByTestId('auto-send-no-match').textContent).toContain('没有符合条件的信')
    expect(rowIds()).toHaveLength(0)
  })

  it('marks the rehearsal letter 演练 in its row and does not count it as sent', async () => {
    await renderReady()
    const row = screen.getByTestId('letter-row-demo-l6')
    expect(row.textContent).toContain('演练 5')
    const cells = Array.from(row.querySelectorAll('td')).map((td) => td.textContent)
    expect(cells[5]).toBe('—')
  })

  it('has no send or release button anywhere on the list', async () => {
    await renderReady()
    expect(screen.queryByRole('button', { name: /发送/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^放行/ })).toBeNull()
  })
})

describe('AutoSendBoard · 抽屉', () => {
  it('shows a sent letter from Mailchimp: tiles, per-guest opens, plain-language reasons, linked names', async () => {
    await renderReady()
    const dialog = await openLetter('demo-l1')
    expect(await within(dialog).findByText('收件人')).toBeTruthy()
    const tiles = within(dialog).getAllByText(/^(收件人|已发|被拦|出错)$/).map((el) => el.parentElement?.textContent)
    expect(tiles).toEqual(['10收件人', '8已发', '1被拦', '1出错'])

    fireEvent.click(within(dialog).getByRole('tab', { name: '收件人与发送情况 10' }))
    expect(within(dialog).getByText('Mailchimp 回传：已打开 6 位 · 其中点了链接 2 位')).toBeTruthy()
    expect(within(dialog).getAllByText('点了链接')).toHaveLength(2)
    expect(within(dialog).getAllByText('已打开')).toHaveLength(4)
    expect(within(dialog).getByText('最近收到的邮件已达上限')).toBeTruthy()
    expect(within(dialog).getByText('最近 7 天已收了 2 封')).toBeTruthy()
    expect(within(dialog).getByText('对方邮箱退回')).toBeTruthy()
    expect(within(dialog).getByText('地址无效')).toBeTruthy()
    expect(within(dialog).getByText('Demo Guest 01').closest('a')?.getAttribute('href')).toBe(
      `/dashboard/clients/${CLIENT}/crm/all?contact=demo-contact-01`,
    )
    expect(dialog.textContent).not.toContain('@')
  })

  it('shows a letter ME sent itself: totals only, every 打开 cell is a dash', async () => {
    await renderReady()
    const dialog = await openLetter('demo-l2')
    await within(dialog).findByText('收件人')
    fireEvent.click(within(dialog).getByRole('tab', { name: '收件人与发送情况 5' }))
    expect(
      within(dialog).getByText('ME 自己发的信：打开 / 点击只记总数（打开 3 次 · 点击 1 次），不记每位客人。'),
    ).toBeTruthy()
    expect(within(dialog).getByText('已在 Mailchimp 退订')).toBeTruthy()
    const lastCells = Array.from(dialog.querySelectorAll('tbody tr')).map((tr) => tr.lastElementChild?.textContent)
    expect(lastCells).toEqual(['—', '—', '—', '—', '—'])
  })

  it('shows rehearsal rows as 演练, not as 已发, and a greyed-out 放行 placeholder', async () => {
    await renderReady()
    const dialog = await openLetter('demo-l6')
    await within(dialog).findByText('收件人')
    const tiles = within(dialog).getAllByText(/^(收件人|已发|被拦|出错|演练)$/).map((el) => el.parentElement?.textContent)
    expect(tiles).toEqual(['5收件人', '—已发', '—被拦', '—出错', '5演练'])

    fireEvent.click(within(dialog).getByRole('tab', { name: '收件人与发送情况 5' }))
    expect(within(dialog).getByRole('note').textContent).toContain('演练：系统彩排了一遍')
    const table = within(dialog).getByRole('table')
    expect(within(table).getAllByText('演练')).toHaveLength(5)
    expect(within(table).queryByText('已发出')).toBeNull()

    const release = within(dialog).getByRole('button', { name: '放行这封信' })
    expect((release as HTMLButtonElement).disabled).toBe(true)
    expect(dialog.textContent).toContain('稍后开放')
  })

  it('a draft has no 放行 placeholder; its content tab folds a long body and unfolds it', async () => {
    await renderReady()
    const dialog = await openLetter('demo-l3')
    expect(await within(dialog).findByText('客人收件箱里看到的第一行')).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: '放行这封信' })).toBeNull()
    expect(within(dialog).getByText('{first_name} 会换成每位客人自己的资料（例如名字）')).toBeTruthy()
    expect(within(dialog).queryByText('Warm regards, The Sample Team')).toBeNull()

    fireEvent.click(within(dialog).getByRole('button', { name: /展开全文（后面还有 1 段）/ }))
    expect(within(dialog).getByText('Warm regards, The Sample Team')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: /收起/ }))
    expect(within(dialog).queryByText('Warm regards, The Sample Team')).toBeNull()
  })

  it('a planned letter says its content is not written yet', async () => {
    await renderReady()
    const dialog = await openLetter('demo-l7')
    expect((await within(dialog).findByTestId('letter-content-missing')).textContent).toContain('还没有写好')
  })

  it('closes on Escape and on a click outside, and gives the focus back to the row', async () => {
    await renderReady()
    const row = screen.getByTestId('letter-row-demo-l1')
    const rowButton = within(row).getByRole('button')
    rowButton.focus()
    fireEvent.click(rowButton)
    await screen.findByRole('dialog')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(rowButton)

    fireEvent.click(rowButton)
    await screen.findByRole('dialog')
    fireEvent.mouseDown(screen.getByTestId('auto-send-drawer-overlay'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('in demo mode the drawer says 示例数据 and the demo guests are not links', async () => {
    render(<AutoSendBoard clientId={CLIENT} />)
    fireEvent.click(await screen.findByRole('button', { name: '看示例（假数据）' }))
    await screen.findByTestId('letter-row-demo-l1')
    const dialog = await openLetter('demo-l1')
    expect(await within(dialog).findByText('示例数据')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('tab', { name: '收件人与发送情况 10' }))
    expect(within(dialog).getByText('Demo Guest 01').closest('a')).toBeNull()
  })

  it('a failed detail read shows an error with 重试', async () => {
    const demo = createDemoAdapter()
    const adapter: AutoSendAdapter = {
      loadOverview: () => demo.loadOverview(),
      loadLetterDetail: () => Promise.reject(new Error('Failed to fetch')),
    }
    render(<AutoSendWorkspace clientId={CLIENT} liveAdapter={adapter} />)
    await screen.findByTestId('auto-send-next-batch')
    const dialog = await openLetter('demo-l1')
    expect((await within(dialog).findByRole('alert')).textContent).toContain('暂时读不到这封信：网络出错')
    expect(within(dialog).getByRole('button', { name: '重试' })).toBeTruthy()
  })
})
