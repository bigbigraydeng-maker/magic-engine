// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LetterBoard, type LetterBoardRow } from '../LetterBoard'

vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))

const row = (id: string, over: Partial<LetterBoardRow> = {}): LetterBoardRow => ({ contactId: id, name: `Guest ${id}`, note: 'note', status: 'ready', recipient: `${id}@example.com`, sentLast7Days: 0, message: null, requestId: `req-${id}`, ...over })
type Check = { id: string; status: 'pass' | 'warn' | 'fail'; label: string; detail: string }
const PASS: Check = { id: 'c1', status: 'pass', label: '价格', detail: '没问题' }
const FAIL: Check = { id: 'c1', status: 'fail', label: '价格', detail: '不在团目录里' }

interface Call { url: string; method: string; body: Record<string, unknown> | null }
let calls: Call[] = []
let draftChecks: Check[] = [PASS]
let recheckChecks: Check[] = [PASS]
let sendStatus = 200
let sendBody: Record<string, unknown> = {}

function install(rows: LetterBoardRow[]) {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null
    calls.push({ url, method: init?.method ?? 'GET', body })
    if (url === '/list') return new Response(JSON.stringify({ rows }), { status: 200 })
    if (url.endsWith('/email/compose/draft')) return new Response(JSON.stringify({ subject: 'Subject', body: 'Body text', checks: draftChecks, read: [{ kind: 'customer', text: '填过表' }], aiLetterId: 'ai-letter-1' }), { status: 200 })
    if (url.endsWith('/email/compose/check')) return new Response(JSON.stringify({ checks: recheckChecks }), { status: 200 })
    if (url.endsWith('/email/compose') || url === '/release') return new Response(JSON.stringify(sendBody), { status: sendStatus })
    return new Response('{}', { status: 404 })
  }))
}

function board(sendUrl?: () => string) {
  return render(
    <LetterBoard surface="letters_page" clientId="c1" listUrl="/list" toBoard={(json) => { const j = json as { rows?: LetterBoardRow[] }; return j.rows ? { rows: j.rows, headline: `今天 ${j.rows.length} 位`, other: '其他说明' } : null }}
      title="信" intro="说明" back={{ href: '/back', label: '回去' }} draftAllLabel="写这一批" sendUrl={sendUrl} />,
  )
}

const sends = () => calls.filter((c) => c.url.endsWith('/email/compose') || c.url === '/release')
const drafts = () => calls.filter((c) => c.url.endsWith('/email/compose/draft'))
const rechecks = () => calls.filter((c) => c.url.endsWith('/email/compose/check'))
const tick = () => screen.getByLabelText('这封可以发') as HTMLInputElement
const release = () => screen.getByText(/放行勾上的/) as HTMLButtonElement

async function drafted() {
  fireEvent.click(await screen.findByText('写这一批'))
  await screen.findByDisplayValue('Subject')
}

beforeEach(() => { sendStatus = 200; sendBody = {}; draftChecks = [PASS]; recheckChecks = [PASS]; vi.spyOn(window, 'confirm').mockReturnValue(true) })
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

  it('drafts only the guests that can be written to, and ticks nothing for the person', async () => {
    install([row('a'), row('b', { status: 'cannot_send', recipient: null, message: '没有邮箱' })])
    board()
    await drafted()
    expect(drafts().map((c) => c.url)).toEqual(['/api/clients/c1/crm/contacts/a/email/compose/draft'])
    expect(drafts()[0].body).toEqual({ kind: 'follow_up', surface: 'letters_page' })
    expect(tick().checked).toBe(false)
    expect(release().disabled).toBe(true)
  })

  it('a draft with a failed check cannot be ticked, so it cannot be released', async () => {
    draftChecks = [FAIL]
    install([row('a')])
    board()
    await drafted()
    expect(screen.getByText(/价格：不在团目录里/)).toBeTruthy()
    expect(tick().disabled).toBe(true)
    fireEvent.click(tick())
    expect(tick().checked).toBe(false)
    expect(release().disabled).toBe(true)
    expect(screen.getByText(/有检查没过/)).toBeTruthy()
  })

  it('editing a ticked letter unticks it; it can be ticked again only after the edited text is checked and passes', async () => {
    install([row('a')])
    board()
    await drafted()
    fireEvent.click(tick())
    expect(tick().checked).toBe(true)
    fireEvent.change(screen.getByLabelText('正文'), { target: { value: 'Edited by a person' } })
    expect(tick().checked).toBe(false)
    expect(tick().disabled).toBe(true)
    expect(release().disabled).toBe(true)
    fireEvent.click(screen.getByText('重新检查'))
    await waitFor(() => expect(tick().disabled).toBe(false))
    expect(rechecks()[0].url).toBe('/api/clients/c1/crm/contacts/a/email/compose/check')
    expect(rechecks()[0].body).toEqual({ subject: 'Subject', body: 'Edited by a person' })
    expect(sends()).toHaveLength(0)
  })

  it('an edit that fails the re-check stays unticked and shows the new checks', async () => {
    recheckChecks = [FAIL]
    install([row('a')])
    board()
    await drafted()
    fireEvent.change(screen.getByLabelText('正文'), { target: { value: 'The Golden China tour' } })
    fireEvent.click(screen.getByText('重新检查'))
    await screen.findByText(/价格：不在团目录里/)
    expect(tick().disabled).toBe(true)
  })

  it('releases only ticked letters, to the compose route by default, with the text, the request id and the recipient', async () => {
    install([row('a'), row('b')])
    board()
    fireEvent.click(await screen.findByText('写这一批'))
    await waitFor(() => expect(screen.getAllByLabelText('这封可以发')).toHaveLength(2))
    fireEvent.click(screen.getAllByLabelText('这封可以发')[0])
    fireEvent.click(release())
    await screen.findByText('已发出。')
    expect(sends()).toHaveLength(1)
    expect(sends()[0].url).toBe('/api/clients/c1/crm/contacts/a/email/compose')
    expect(sends()[0].body).toEqual({ contactId: 'a', subject: 'Subject', body: 'Body text', requestId: 'req-a', expectedRecipient: 'a@example.com', aiLetterId: 'ai-letter-1' })
  })

  it('a page with its own release route posts there, and shows that route\'s refusal with its fresh checks', async () => {
    install([row('a')])
    sendStatus = 409
    sendBody = { error: '名单打开之后有人联系过他，这封没有发。', reason: 'recent_activity', final: true }
    board(() => '/release')
    await drafted()
    fireEvent.click(tick())
    fireEvent.click(release())
    await screen.findByText(/名单打开之后有人联系过他/)
    // The refusal is about the guest, not the text: no "fix and send again".
    expect(screen.queryByText('改好再发')).toBeNull()
    expect(sends()[0].url).toBe('/release')
    expect(sends()[0].body).toMatchObject({ contactId: 'a', requestId: 'req-a' })

    cleanup()
    install([row('a')])
    sendBody = { error: '检查没过，这封没有发', reason: 'check_failed', checks: [FAIL] }
    board(() => '/release')
    await drafted()
    fireEvent.click(tick())
    fireEvent.click(release())
    await screen.findByText(/检查没过，这封没有发/)
    expect(screen.getByText(/价格：不在团目录里/)).toBeTruthy()
  })

  it('a letter a colleague already released is not sent twice, and the person is told so', async () => {
    install([row('a')])
    sendBody = { ok: true, duplicate: true }
    board()
    await drafted()
    fireEvent.click(tick())
    fireEvent.click(release())
    await screen.findByText(/之前已经发出过/)
    expect(screen.queryByText('已发出。')).toBeNull()
  })

  it('saying no to the confirm sends nothing', async () => {
    install([row('a')])
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    board()
    await drafted()
    fireEvent.click(tick())
    fireEvent.click(release())
    expect(sends()).toHaveLength(0)
  })

  it('a refused letter can be fixed and sent again; an unknown outcome never offers a resend', async () => {
    install([row('a')])
    sendStatus = 409
    sendBody = { error: '这周已经发过 2 封', reason: 'weekly_cap' }
    board()
    await drafted()
    fireEvent.click(tick())
    fireEvent.click(release())
    await screen.findByText(/这周已经发过 2 封/)
    expect(screen.getByText('改好再发')).toBeTruthy()

    cleanup()
    install([row('a')])
    sendStatus = 502
    sendBody = { error: '发信服务没回' }
    board()
    await drafted()
    fireEvent.click(tick())
    fireEvent.click(release())
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
