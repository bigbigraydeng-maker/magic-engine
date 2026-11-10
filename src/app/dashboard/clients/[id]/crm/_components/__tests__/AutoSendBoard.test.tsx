/**
 * 「自动发信」页面：状态切换（加载中 / 还没接通 / 出错 / 空 / 有数据）、筛选、「看这批」、
 * 示例数据的标明、抽屉（内容 / 收件人与发送情况）、演练不算已发、没有任何发信按钮。
 * 数据全是合成的示例（src/lib/crm/auto-send/demo-data.ts），这里不碰任何真实客人。
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AutoSendBoard, AutoSendWorkspace } from '../auto-send/AutoSendBoard'
import { AutoSendNotConnectedError, type AutoSendAdapter } from '@/lib/crm/auto-send/adapter'
import { createDemoAdapter } from '@/lib/crm/auto-send/demo-data'

const CLIENT = 'client-123'

/** 切到「按信看」（有团可看时页面先显示「按团看」）。 */
function showLetters(): void {
  fireEvent.click(screen.getByRole('button', { name: '按信看' }))
}

/** 用示例数据当「真实数据」：页面不会标示例，客人姓名会是链接。默认切到「按信看」，因为多数检查看的是一封封信。 */
async function renderReady(view: 'letters' | 'groups' = 'letters'): Promise<void> {
  render(<AutoSendWorkspace clientId={CLIENT} liveAdapter={createDemoAdapter()} />)
  await screen.findByTestId('auto-send-next-batch')
  if (view === 'letters') showLetters()
}

/** 数据来源暂时没有：适配器报「还没接通」。 */
const NOT_CONNECTED: AutoSendAdapter = {
  loadOverview: () => Promise.reject(new AutoSendNotConnectedError()),
  loadLetterDetail: () => Promise.reject(new AutoSendNotConnectedError()),
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
    render(<AutoSendWorkspace clientId={CLIENT} liveAdapter={NOT_CONNECTED} />)
    expect(await screen.findByTestId('auto-send-not-connected')).toBeTruthy()
    expect(screen.queryByTestId('auto-send-demo-banner')).toBeNull()
    expect(screen.queryAllByTestId(/^letter-row-/)).toHaveLength(0)
    expect(screen.getByRole('button', { name: '看示例（假数据）' })).toBeTruthy()
  })

  it('看示例 shows the demo letters under a banner; 退出示例 goes back to not-connected', async () => {
    render(<AutoSendWorkspace clientId={CLIENT} liveAdapter={NOT_CONNECTED} />)
    fireEvent.click(await screen.findByRole('button', { name: '看示例（假数据）' }))
    expect(await screen.findByTestId('auto-send-demo-banner')).toBeTruthy()
    expect(screen.getByTestId('auto-send-demo-banner').textContent).toContain('示例数据（假的）')
    expect(await screen.findByTestId('section-groups')).toBeTruthy()
    showLetters()
    await waitFor(() => expect(rowIds().length).toBe(13))

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
    showLetters()
    expect(rowIds().length).toBe(13)
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
      loadOverview: () => Promise.resolve({ nextBatch: null, sections: [], groups: [] }),
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
          groups: [],
        }),
      loadLetterDetail: () => Promise.reject(new Error('没有')),
    }
    render(<AutoSendWorkspace clientId={CLIENT} liveAdapter={withDate} />)
    expect((await screen.findByTestId('auto-send-empty')).textContent).toContain('第一批会在 12月2日（周三） 发出。')
  })
})

describe('AutoSendBoard · 服务器提醒', () => {
  const NOTICE = '有 2 张已交定金的订单没有出发日（或日期不对），没排进任何一封信。请先在订单里补上出发日。'

  it('shows the notices above an otherwise empty page — that is exactly when they matter', async () => {
    const adapter: AutoSendAdapter = {
      loadOverview: () => Promise.resolve({ nextBatch: null, sections: [], groups: [], notices: [NOTICE] }),
      loadLetterDetail: () => Promise.reject(new Error('没有')),
    }
    render(<AutoSendWorkspace clientId={CLIENT} liveAdapter={adapter} />)
    expect((await screen.findByTestId('auto-send-notices')).textContent).toContain(NOTICE)
    expect(screen.getByTestId('auto-send-empty')).toBeTruthy()
  })

  it('shows the notices above the lists when there are letters, and nothing when there are none', async () => {
    const demo = await createDemoAdapter().loadOverview()
    const withNotice: AutoSendAdapter = {
      loadOverview: () => Promise.resolve({ ...demo, notices: [NOTICE] }),
      loadLetterDetail: () => Promise.reject(new Error('没有')),
    }
    const { unmount } = render(<AutoSendWorkspace clientId={CLIENT} liveAdapter={withNotice} />)
    expect((await screen.findByTestId('auto-send-notices')).textContent).toContain(NOTICE)
    unmount()

    const without: AutoSendAdapter = { loadOverview: () => Promise.resolve(demo), loadLetterDetail: () => Promise.reject(new Error('没有')) }
    render(<AutoSendWorkspace clientId={CLIENT} liveAdapter={without} />)
    await screen.findByTestId('auto-send-next-batch')
    expect(screen.queryByTestId('auto-send-notices')).toBeNull()
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
    expect(screen.getByTestId('section-past').textContent).toContain('已过发信日的信（系统里有发送记录或提交记录的）')
    expect(screen.getByTestId('auto-send-legend').textContent).toContain('演练')
    expect(screen.queryByTestId('auto-send-demo-banner')).toBeNull()
    expect(rowIds()).toHaveLength(13)
  })

  it('filters by status; 已发 and 有被拦的 never include a rehearsal-only or draft letter', async () => {
    await renderReady()
    fireEvent.click(screen.getByRole('button', { name: '草稿' }))
    expect(rowIds()).toEqual(['letter-row-demo-l3', 'letter-row-demo-l4', 'letter-row-demo-l5'])

    fireEvent.click(screen.getByRole('button', { name: '等你放行' }))
    expect(rowIds()).toEqual(['letter-row-demo-l6'])

    fireEvent.click(screen.getByRole('button', { name: '已发' }))
    expect(rowIds()).toEqual(['letter-row-demo-l2', 'letter-row-demo-l1'])

    fireEvent.click(screen.getByRole('button', { name: '有被拦的' }))
    // the two past batches nobody received also had blocked or failed guests
    expect(rowIds()).toEqual(['letter-row-demo-l2', 'letter-row-demo-l11', 'letter-row-demo-l12', 'letter-row-demo-l1'])

    fireEvent.click(screen.getByRole('button', { name: '没发出去' }))
    expect(rowIds()).toEqual(['letter-row-demo-l11'])

    fireEvent.click(screen.getByRole('button', { name: '结果不明' }))
    expect(rowIds()).toEqual(['letter-row-demo-l12'])

    fireEvent.click(screen.getByRole('button', { name: '全部' }))
    expect(rowIds()).toHaveLength(13)
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
    expect(rowIds()).toHaveLength(13)
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

describe('AutoSendBoard · 没发出去 / 结果不明', () => {
  const pTexts = (root: HTMLElement): Array<string | null> => Array.from(root.querySelectorAll('p')).map((p) => p.textContent)

  it('the list row of a letter nobody got shows the status and the errors; the one with unknown results shows how many', async () => {
    await renderReady()
    const notSent = screen.getByTestId('letter-row-demo-l11')
    expect(notSent.textContent).toContain('没发出去')
    const cells11 = Array.from(notSent.querySelectorAll('td')).map((td) => td.textContent)
    expect(cells11[5]).toBe('0') // sent
    expect(cells11[6]).toBe('3出错 2') // blocked, then the errors
    const unknown = screen.getByTestId('letter-row-demo-l12')
    expect(unknown.textContent).toContain('结果不明')
    const cells12 = Array.from(unknown.querySelectorAll('td')).map((td) => td.textContent)
    expect(cells12[6]).toBe('1结果不明 4')
  })

  it('the phone card of each letter says the same: the errors, and the people whose result is unknown', async () => {
    await renderReady()
    expect(screen.getByTestId('letter-card-demo-l11').textContent).toContain('被拦 3 · 出错 2')
    expect(screen.getByTestId('letter-card-demo-l12').textContent).toContain('被拦 1 · 结果不明 4')
    expect(screen.getByTestId('letter-card-demo-l1').textContent).not.toContain('结果不明')
  })

  it('the legend explains both statuses in plain words, including what not to do', async () => {
    await renderReady()
    const legend = screen.getByTestId('auto-send-legend').textContent ?? ''
    expect(legend).toContain('没发出去')
    expect(legend).toContain('一封都没送到客人手里')
    expect(legend).toContain('结果不明')
    expect(legend).toContain('先别重发')
  })

  it('the drawer of a letter nobody got says why, in one sentence under the numbers, and has no tile for unknown results', async () => {
    await renderReady()
    const dialog = await openLetter('demo-l11')
    const note = await within(dialog).findByTestId('auto-send-status-note')
    expect(note.textContent).toBe('这一批一封都没送到客人手里（被拦 3 位，出错 2 位）。')
    expect(pTexts(dialog)).not.toContain('结果不明')
  })

  it('the drawer of a letter with unknown results says not to resend, shows the tile, and lists those guests as 结果不明 with the reason', async () => {
    await renderReady()
    const dialog = await openLetter('demo-l12')
    const note = await within(dialog).findByTestId('auto-send-status-note')
    expect(note.textContent).toBe('有 4 位结果不明：信可能已经送到，先别重发。')
    expect(pTexts(dialog)).toContain('结果不明') // the tile label
    fireEvent.click(within(dialog).getByRole('tab', { name: /收件人与发送情况/ }))
    const guest = await within(dialog).findByTestId('recipient-demo-contact-22')
    expect(guest.textContent).toContain('结果不明')
    expect(guest.textContent).toContain('发送结果不明，等人核对')
    expect(dialog.textContent).toContain('下面标「结果不明」的：发出了，但没拿到最终结果')
  })

  it('a letter that went out normally has neither the sentence nor the note', async () => {
    await renderReady()
    const dialog = await openLetter('demo-l1')
    await within(dialog).findByRole('heading', { name: 'Sample letter: how the weather looks on your route' })
    expect(within(dialog).queryByTestId('auto-send-status-note')).toBeNull()
  })
})

describe('AutoSendBoard · 抽屉', () => {
  it('shows a sent letter from Mailchimp: tiles, per-guest opens, plain-language reasons, linked names', async () => {
    await renderReady()
    const dialog = await openLetter('demo-l1')
    expect(await within(dialog).findByText('收件人')).toBeTruthy()
    const tiles = within(dialog).getAllByText(/^(收件人|已发|被拦|出错|打开（仅供参考）)$/).map((el) => el.parentElement?.textContent)
    expect(tiles).toEqual(['10收件人', '8已发', '1被拦', '1出错', '6打开（仅供参考）'])

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

  it('shows a letter ME sent itself: no open numbers anywhere, every 打开 cell is a dash', async () => {
    await renderReady()
    const dialog = await openLetter('demo-l2')
    await within(dialog).findByText('收件人')
    expect(within(dialog).queryByText('打开（仅供参考）')).toBeNull() // no opened tile when opens are not recorded
    fireEvent.click(within(dialog).getByRole('tab', { name: '收件人与发送情况 5' }))
    expect(within(dialog).queryByText(/只记总数/)).toBeNull()
    expect(within(dialog).queryByText(/已打开 \d+ 位/)).toBeNull()
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
    render(<AutoSendWorkspace clientId={CLIENT} liveAdapter={NOT_CONNECTED} />)
    fireEvent.click(await screen.findByRole('button', { name: '看示例（假数据）' }))
    await screen.findByTestId('section-groups')
    showLetters()
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
    showLetters()
    const dialog = await openLetter('demo-l1')
    expect((await within(dialog).findByRole('alert')).textContent).toContain('暂时读不到这封信：网络出错')
    expect(within(dialog).getByRole('button', { name: '重试' })).toBeTruthy()
    expect(within(dialog).getByRole('heading', { name: '读不到这封信' })).toBeTruthy()
  })
})

describe('AutoSendBoard · 真实数据走读接口（对外只收 clientId）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const LIST = {
    generatedAt: '2026-11-10T09:00:00+13:00',
    nextBatch: { sendDate: '2026-12-02', weekdayLabel: '周三', letterCount: 1, recipientCount: 2, phase: 'draft' },
    depositLetters: [],
    scheduledLetters: [
      {
        letterKey: 'plan:2026-12-02:t-1:2027-03-11:3',
        sendDate: '2026-12-02',
        audience: { tourName: 'Tour One', departOn: '2027-03-11', monthsLeft: 3 },
        subject: null,
        status: 'draft',
        channel: 'me',
        counts: { recipients: 2, sent: null, blocked: null, failed: null, rehearsal: 0, opened: null },
      },
    ],
    pastLetters: [],
    tourGroups: [],
    totalDistinctLetters: 7,
    cadence: { firstMonth: 6 },
  }

  it('shows the planned letters it reads from the interface, not the demo, and links names to the customer page', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/crm/auto-letters')) return new Response(JSON.stringify(LIST), { status: 200 })
      return new Response(
        JSON.stringify({
          letter: { ...LIST.scheduledLetters[0], previewText: null, bodyText: null, sampleFirstName: 'Alex' },
          tiles: { recipients: 2, sent: null, blocked: null, failed: null, rehearsal: 0, opened: null },
          mailchimpSummary: null,
          recipients: [
            { contactId: 'c-1', displayName: 'Pat One', seats: 2, status: 'pending', reasonText: null, opened: null, clicked: null },
          ],
        }),
        { status: 200 },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<AutoSendBoard clientId={CLIENT} />)
    const row = await screen.findByTestId('letter-row-plan:2026-12-02:t-1:2027-03-11:3')
    expect(row.textContent).toContain('12月2日（周三）')
    expect(row.textContent).toContain('3月11日团 · 3个月信')
    expect(row.textContent).toContain('（还没写）')
    expect(screen.queryByTestId('auto-send-demo-banner')).toBeNull()
    expect(screen.queryByTestId('auto-send-not-connected')).toBeNull()

    fireEvent.click(within(row).getByRole('button'))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(await within(dialog).findByRole('tab', { name: '收件人与发送情况 2' }))
    expect(within(dialog).getByText('Pat One').closest('a')?.getAttribute('href')).toBe(
      `/dashboard/clients/${CLIENT}/crm/all?contact=c-1`,
    )
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      `/api/clients/${CLIENT}/crm/auto-letters`,
      `/api/clients/${CLIENT}/crm/auto-letters/plan%3A2026-12-02%3At-1%3A2027-03-11%3A3`,
    ])
  })

  it('a refused read (no access) shows the Chinese reason, not an empty list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'x' }), { status: 403 })),
    )
    render(<AutoSendBoard clientId={CLIENT} />)
    expect((await screen.findByRole('alert')).textContent).toContain('你的账号没有查看这一页的权限。')
    expect(screen.queryByTestId('auto-send-empty')).toBeNull()
  })
})

describe('AutoSendBoard · 按团看', () => {
  const groupRow = (id: string): HTMLElement => screen.getByTestId(`group-row-${id}`)
  const cellsOf = (el: HTMLElement): Array<string | null> => Array.from(el.querySelectorAll('td')).map((td) => td.textContent)

  it('opens on 按团看 when there are groups: one row per group, no letter rows, and a way to switch', async () => {
    await renderReady('groups')
    expect(screen.getByTestId('section-groups')).toBeTruthy()
    expect(screen.queryAllByTestId(/^group-row-/)).toHaveLength(4)
    expect(rowIds()).toHaveLength(0)
    expect(screen.getByRole('button', { name: '按团看' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '按信看' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByRole('group', { name: '按状态筛选' })).toBeNull() // the status filters belong to the letter view
  })

  it('a group row says which tour, how many people, what went out, what is ahead, the last result and the next letter', async () => {
    await renderReady('groups')
    const a = cellsOf(groupRow('demo-group-a'))
    expect(a[0]).toContain('示例团甲')
    expect(a[0]).toContain('3月11日出发')
    expect(a.slice(1, 5)).toEqual(['10', '1 封', '2 封', '10月7日 · 已发 8 · 被拦 1 · 出错 1 · 打开 6'])
    expect(a[5]).toContain('12月2日（周三）')
    expect(a[5]).toContain('草稿')

    // a letter ME sent does not record opens: a dash, never a made-up number
    expect(cellsOf(groupRow('demo-group-b'))[4]).toBe('11月4日 · 已发 4 · 被拦 1 · 打开 —')
  })

  it('a group nothing has gone out for says 还没发过 and shows where its next letter stands', async () => {
    await renderReady('groups')
    const c = cellsOf(groupRow('demo-group-c'))
    // nothing sent, one letter that was due but nobody got it (errors), two still ahead
    expect(c.slice(2, 5)).toEqual(['0 封过期没发 1 封', '2 封', '还没发过'])
    expect(cellsOf(groupRow('demo-group-d'))[5]).toContain('等你放行')
  })

  it('a group with a letter whose results are unknown says so next to its sent count, apart from the overdue ones', async () => {
    await renderReady('groups')
    const d = cellsOf(groupRow('demo-group-d'))
    expect(d[2]).toBe('0 封结果不明 1 封')
    expect(d[2]).not.toContain('过期没发')
    expect(groupRow('demo-group-a').textContent).not.toContain('结果不明')
    // the phone card says the same
    expect(screen.getByTestId('group-card-demo-group-d').textContent).toContain('结果不明 1 封')
    expect(screen.getByTestId('group-card-demo-group-c').textContent).toContain('过期没发 1 封')
  })

  it('opening those groups shows the letter nobody got and the letter with unknown results, each with its own status and numbers', async () => {
    await renderReady('groups')
    fireEvent.click(groupRow('demo-group-c'))
    const [listC] = screen.getAllByTestId('group-letters-demo-group-c')
    const firstC = within(listC).getAllByRole('button')[0]
    expect(firstC.textContent).toContain('11月4日')
    expect(firstC.textContent).toContain('没发出去')
    expect(firstC.textContent).toContain('已发 0 · 被拦 3 · 出错 2 · 打开 —')

    fireEvent.click(groupRow('demo-group-d'))
    const [listD] = screen.getAllByTestId('group-letters-demo-group-d')
    const firstD = within(listD).getAllByRole('button')[0]
    expect(firstD.textContent).toContain('结果不明')
    expect(firstD.textContent).toContain('已发 0 · 被拦 1 · 结果不明 4 · 打开 —')
  })

  it('opening a group lists its letters oldest first; a click on a letter opens the drawer for that letter', async () => {
    await renderReady('groups')
    fireEvent.click(within(groupRow('demo-group-a')).getByRole('button', { name: /展开这个团的信/ }))
    const [list] = screen.getAllByTestId('group-letters-demo-group-a') // the table and the phone card share the open state
    const items = within(list).getAllByRole('button')
    expect(items).toHaveLength(3)
    expect(items[0].textContent).toContain('10月7日')
    expect(items[0].textContent).toContain('已发出')
    expect(items[0].textContent).toContain('已发 8 · 被拦 1 · 出错 1 · 打开 6')
    expect(items[1].textContent).toContain('草稿')
    expect(items[2].textContent).toContain('计划中')
    expect(items[2].textContent).toContain('还没发')

    fireEvent.click(items[0])
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByRole('heading', { name: 'Sample letter: how the weather looks on your route' })).toBeTruthy()
  })

  it('a click on the row (not only the name) opens and closes the group; only one group is open at a time', async () => {
    await renderReady('groups')
    fireEvent.click(groupRow('demo-group-a'))
    expect(screen.getAllByTestId('group-letters-demo-group-a').length).toBeGreaterThan(0)
    fireEvent.click(groupRow('demo-group-b'))
    expect(screen.queryAllByTestId('group-letters-demo-group-a')).toHaveLength(0)
    expect(screen.getAllByTestId('group-letters-demo-group-b').length).toBeGreaterThan(0)
    fireEvent.click(groupRow('demo-group-b'))
    expect(screen.queryAllByTestId('group-letters-demo-group-b')).toHaveLength(0)
  })

  it('shows the phone card of every group too, with the same numbers', async () => {
    await renderReady('groups')
    const card = screen.getByTestId('group-card-demo-group-a')
    expect(card.textContent).toContain('示例团甲')
    expect(card.textContent).toContain('收件人 10 · 已发 1 封 · 往后 2 封')
    expect(card.textContent).toContain('10月7日 · 已发 8 · 被拦 1 · 出错 1 · 打开 6')
  })

  it('flags letters that were due but never went out, and only on the group they belong to', async () => {
    const demo = await createDemoAdapter().loadOverview()
    const adapter: AutoSendAdapter = {
      loadOverview: async () => ({ ...demo, groups: demo.groups.map((g, i) => (i === 0 ? { ...g, lettersOverdue: 2 } : g)) }),
      loadLetterDetail: () => Promise.reject(new Error('没有')),
    }
    render(<AutoSendWorkspace clientId={CLIENT} liveAdapter={adapter} />)
    await screen.findByTestId('group-row-demo-group-a')
    expect(groupRow('demo-group-a').textContent).toContain('过期没发 2 封')
    expect(groupRow('demo-group-b').textContent).not.toContain('过期没发')
  })

  it('switches between the two views; 看这批 (a letter-view filter) takes the page to the letter view', async () => {
    await renderReady('groups')
    showLetters()
    expect(rowIds()).toHaveLength(13)
    fireEvent.click(screen.getByRole('button', { name: '按团看' }))
    expect(screen.queryAllByTestId(/^group-row-/)).toHaveLength(4)

    fireEvent.click(screen.getByRole('button', { name: '看这批' }))
    expect(rowIds()).toEqual(['letter-row-demo-l3', 'letter-row-demo-l4', 'letter-row-demo-l5', 'letter-row-demo-l6'])
    expect(screen.queryByTestId('section-groups')).toBeNull()
    expect(screen.getByRole('button', { name: '按信看' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('with no groups there is no switch and the page shows the letters', async () => {
    const demo = await createDemoAdapter().loadOverview()
    const adapter: AutoSendAdapter = { loadOverview: async () => ({ ...demo, groups: [] }), loadLetterDetail: () => Promise.reject(new Error('没有')) }
    render(<AutoSendWorkspace clientId={CLIENT} liveAdapter={adapter} />)
    await screen.findByTestId('auto-send-next-batch')
    expect(screen.queryByRole('group', { name: '换个角度看' })).toBeNull()
    expect(rowIds()).toHaveLength(13)
  })

  it('has no send or release button in the group view either', async () => {
    await renderReady('groups')
    expect(screen.queryByRole('button', { name: /发送/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^放行/ })).toBeNull()
  })
})

describe('AutoSendBoard · 打开（仅供参考）', () => {
  it('the letter list has a 打开 column: a number where opens are recorded, a dash where they are not', async () => {
    await renderReady()
    const heads = Array.from(document.querySelectorAll('thead th')).map((th) => th.textContent)
    expect(heads).toContain('打开')
    const cellsOf = (id: string) => Array.from(screen.getByTestId(`letter-row-${id}`).querySelectorAll('td')).map((td) => td.textContent)
    expect(cellsOf('demo-l1')[7]).toBe('6')
    expect(cellsOf('demo-l2')[7]).toBe('—')
    expect(cellsOf('demo-l3')[7]).toBe('—')
  })

  it('says opens are reference only, in the letter view and in the group view', async () => {
    await renderReady()
    expect(document.body.textContent).toContain('「打开」只能当参考')
    fireEvent.click(screen.getByRole('button', { name: '按团看' }))
    expect(screen.getByTestId('section-groups').textContent).toContain('「打开」只能当参考')
  })
})

describe('AutoSendBoard · 真实数据：发完的批次和按团汇总', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const SENT_KEY = 'plan:2026-11-04:t-1:2027-03-11:4'
  const NEXT_KEY = 'plan:2026-12-02:t-1:2027-03-11:3'
  const letter = (key: string, sendDate: string, months: number, over: Record<string, unknown> = {}) => ({
    letterKey: key,
    sendDate,
    audience: { tourName: 'Tour One', departOn: '2027-03-11', monthsLeft: months },
    subject: null,
    status: 'draft',
    channel: 'me',
    counts: { recipients: 2, sent: null, blocked: null, failed: null, rehearsal: 0, opened: null },
    ...over,
  })
  const LIST = {
    generatedAt: '2026-11-10T09:00:00+13:00',
    nextBatch: { sendDate: '2026-12-02', weekdayLabel: '周三', letterCount: 1, recipientCount: 2, phase: 'draft' },
    depositLetters: [],
    scheduledLetters: [letter(NEXT_KEY, '2026-12-02', 3, { subject: 'Next one' })],
    pastLetters: [
      letter(SENT_KEY, '2026-11-04', 4, {
        subject: 'Sent one',
        status: 'sent',
        counts: { recipients: 2, sent: 1, blocked: 1, failed: 0, rehearsal: 0, opened: null },
      }),
    ],
    tourGroups: [
      {
        groupKey: 'g:abc1234:2027-03-11',
        tourName: 'Tour One',
        departOn: '2027-03-11',
        recipients: 2,
        lettersSent: 1,
        lettersAhead: 6,
        lettersOverdue: 0,
        lastSent: { letterKey: SENT_KEY, sendDate: '2026-11-04', recipients: 2, sent: 1, blocked: 1, failed: 0, opened: null },
        next: { letterKey: NEXT_KEY, sendDate: '2026-12-02', status: 'draft' },
        letterKeys: [SENT_KEY, NEXT_KEY],
      },
    ],
    totalDistinctLetters: 7,
    cadence: { firstMonth: 6 },
  }

  it('starts on the group, shows what already went out, and opens that past letter from the group', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/crm/auto-letters')) return new Response(JSON.stringify(LIST), { status: 200 })
      return new Response(
        JSON.stringify({
          letter: { ...LIST.pastLetters[0], previewText: null, bodyText: null, sampleFirstName: 'Alex' },
          tiles: { recipients: 2, sent: 1, blocked: 1, failed: 0, rehearsal: 0, opened: null },
          mailchimpSummary: null,
          recipients: [],
        }),
        { status: 200 },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<AutoSendBoard clientId={CLIENT} />)
    const row = await screen.findByTestId('group-row-g:abc1234:2027-03-11')
    const cells = Array.from(row.querySelectorAll('td')).map((td) => td.textContent)
    expect(cells.slice(1, 5)).toEqual(['2', '1 封', '6 封', '11月4日 · 已发 1 · 被拦 1 · 打开 —'])
    expect(cells[5]).toContain('12月2日（周三）')

    fireEvent.click(within(row).getByRole('button', { name: /展开这个团的信/ }))
    const [list] = screen.getAllByTestId('group-letters-g:abc1234:2027-03-11')
    fireEvent.click(within(list).getAllByRole('button')[0])
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByRole('heading', { name: 'Sent one' })).toBeTruthy()
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      `/api/clients/${CLIENT}/crm/auto-letters`,
      `/api/clients/${CLIENT}/crm/auto-letters/${encodeURIComponent(SENT_KEY)}`,
    ])
  })

  it('in the letter view the letter that already went out is in its own panel after the upcoming ones', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(LIST), { status: 200 })))
    render(<AutoSendBoard clientId={CLIENT} />)
    await screen.findByTestId('section-groups')
    showLetters()
    expect(rowIds()).toEqual([`letter-row-${NEXT_KEY}`, `letter-row-${SENT_KEY}`])
    expect(screen.getByTestId('section-past').textContent).toContain('已过发信日的信')
    expect(screen.getByTestId(`letter-row-${SENT_KEY}`).textContent).toContain('已发出')
  })
})
