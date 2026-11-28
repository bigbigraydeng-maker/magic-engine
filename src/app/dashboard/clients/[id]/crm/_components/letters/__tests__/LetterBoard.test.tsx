// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LetterBoard, type LetterBoardRow } from '../LetterBoard'

vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))

const row = (id: string, over: Partial<LetterBoardRow> = {}): LetterBoardRow => ({ contactId: id, name: `Guest ${id}`, note: 'note', status: 'ready', recipient: `${id}@example.com`, sentLast7Days: 0, message: null, requestId: `req-${id}`, ...over })

interface Call { url: string; method: string; body: Record<string, unknown> | null }
let calls: Call[] = []
let sendStatus = 200
let sendBody: Record<string, unknown> = {}

function install(rows: LetterBoardRow[]) {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null
    calls.push({ url, method: init?.method ?? 'GET', body })
    if (url === '/list') return new Response(JSON.stringify({ rows }), { status: 200 })
    if (url.endsWith('/email/compose/draft')) return new Response(JSON.stringify({ subject: 'Subject', body: 'Body text', checks: [{ id: 'c1', status: 'fail', label: '价格', detail: '不在团目录里' }], read: [{ kind: 'customer', text: '填过表' }] }), { status: 200 })
    if (url.endsWith('/email/compose')) return new Response(JSON.stringify(sendBody), { status: sendStatus })
    return new Response('{}', { status: 404 })
  }))
}

function board() {
  return render(
    <LetterBoard clientId="c1" listUrl="/list" toBoard={(json) => { const j = json as { rows?: LetterBoardRow[] }; return j.rows ? { rows: j.rows, headline: `今天 ${j.rows.length} 位`, other: '其他说明' } : null }}
      title="信" intro="说明" back={{ href: '/back', label: '回去' }} draftAllLabel="写这一批" />,
  )
}

const sends = () => calls.filter((c) => c.url.endsWith('/email/compose'))
const drafts = () => calls.filter((c) => c.url.endsWith('/email/compose/draft'))

beforeEach(() => { sendStatus = 200; sendBody = {}; vi.spyOn(window, 'confirm').mockReturnValue(true) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('LetterBoard', () => {
  it('shows the list, the page\'s own lines and each guest\'s note; nothing is drafted or sent on load', async () => {
    install([row('a'), row('b', { status: 'cannot_send', recipient: null, message: '没有邮箱' })])
    board()
    await screen.findByText('今天 2 位')
    expect(screen.getByText('其他说明')).toBeTruthy()
    expect(screen.getByText('发不了：没有邮箱')).toBeTruthy()
    expect(drafts()).toHaveLength(0)
    expect(sends()).toHaveLength(0)
  })

  it('drafts only the guests that can be written to, shows the checks, and ticks nothing for the person', async () => {
    install([row('a'), row('b', { status: 'cannot_send', recipient: null, message: '没有邮箱' })])
    board()
    fireEvent.click(await screen.findByText('写这一批'))
    await screen.findByDisplayValue('Subject')
    expect(drafts().map((c) => c.url)).toEqual(['/api/clients/c1/crm/contacts/a/email/compose/draft'])
    expect(drafts()[0].body).toEqual({ kind: 'follow_up' })
    expect(screen.getByText(/价格：不在团目录里/)).toBeTruthy()
    const tick = screen.getByLabelText('这封可以发') as HTMLInputElement
    expect(tick.checked).toBe(false)
    expect((screen.getByText(/放行勾上的/) as HTMLButtonElement).disabled).toBe(true)
  })

  it('releases only ticked letters, with the edited text, the row\'s request id and the expected recipient', async () => {
    install([row('a'), row('b')])
    board()
    fireEvent.click(await screen.findByText('写这一批'))
    await waitFor(() => expect(screen.getAllByLabelText('这封可以发')).toHaveLength(2))
    fireEvent.change(screen.getAllByLabelText('正文')[0], { target: { value: 'Edited by a person' } })
    // The person is told the checks below are for the AI's original text, not the edit.
    expect(screen.getByText(/你改过正文/)).toBeTruthy()
    fireEvent.click(screen.getAllByLabelText('这封可以发')[0])
    fireEvent.click(screen.getByText(/放行勾上的/))
    await screen.findByText('已发出。')
    expect(sends()).toHaveLength(1)
    expect(sends()[0].url).toBe('/api/clients/c1/crm/contacts/a/email/compose')
    expect(sends()[0].body).toEqual({ subject: 'Subject', body: 'Edited by a person', requestId: 'req-a', expectedRecipient: 'a@example.com' })
  })

  it('saying no to the confirm sends nothing', async () => {
    install([row('a')])
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    board()
    fireEvent.click(await screen.findByText('写这一批'))
    fireEvent.click(await screen.findByLabelText('这封可以发'))
    fireEvent.click(screen.getByText(/放行勾上的/))
    expect(sends()).toHaveLength(0)
  })

  it('a refused letter can be fixed and sent again; an unknown outcome never offers a resend', async () => {
    install([row('a')])
    sendStatus = 409
    sendBody = { error: '这周已经发过 2 封', reason: 'weekly_cap' }
    board()
    fireEvent.click(await screen.findByText('写这一批'))
    fireEvent.click(await screen.findByLabelText('这封可以发'))
    fireEvent.click(screen.getByText(/放行勾上的/))
    await screen.findByText(/这周已经发过 2 封/)
    expect(screen.getByText('改好再发')).toBeTruthy()

    cleanup()
    install([row('a')])
    sendStatus = 502
    sendBody = { error: '发信服务没回' }
    board()
    fireEvent.click(await screen.findByText('写这一批'))
    fireEvent.click(await screen.findByLabelText('这封可以发'))
    fireEvent.click(screen.getByText(/放行勾上的/))
    await screen.findByText(/先别重发/)
    expect(screen.queryByText('改好再发')).toBeNull()
  })

  it('a list that cannot be read shows the error and a retry, never an empty "nobody today"', async () => {
    calls = []
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: '暂时读不到名单' }), { status: 503 })))
    board()
    await screen.findByText(/暂时读不到名单/)
    expect(screen.getByText('再试一次')).toBeTruthy()
    expect(screen.queryByText(/今天 0 位/)).toBeNull()
  })
})
