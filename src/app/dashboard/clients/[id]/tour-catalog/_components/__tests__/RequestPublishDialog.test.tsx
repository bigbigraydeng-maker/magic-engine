import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { PublishRequestView } from '@/lib/tour-catalog/catalog-contract'
import {
  RequestPublishDialog,
  PublishRequestNotice,
  publishRequestNoticeText,
  REQUEST_PUBLISH_ERROR,
  REQUEST_PUBLISH_INTRO,
} from '../RequestPublishDialog'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

const request: PublishRequestView = {
  id: 'r1',
  requestedBy: 'amy@example.test',
  note: '改了价格',
  createdAt: '2026-10-10T03:30:00Z',
  draftVersion: 5,
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async () => jsonResponse({ request }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function renderDialog(overrides: {
  onClose?: () => void
  onSubmitted?: (r: PublishRequestView) => void
} = {}) {
  const onClose = overrides.onClose ?? vi.fn()
  const onSubmitted = overrides.onSubmitted ?? vi.fn()
  render(<RequestPublishDialog clientId="c1" onClose={onClose} onSubmitted={onSubmitted} />)
  return { onClose, onSubmitted }
}

describe('RequestPublishDialog', () => {
  it('renders the dialog, intro and labelled textarea', () => {
    renderDialog()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText(REQUEST_PUBLISH_INTRO)).toBeInTheDocument()
    expect(screen.getByLabelText('这次改了什么（选填）')).toBeInTheDocument()
  })

  it('submits the trimmed note and reports the returned request', async () => {
    const { onSubmitted } = renderDialog()
    fireEvent.change(screen.getByLabelText('这次改了什么（选填）'), {
      target: { value: '  改了三个团的价格  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: '提交' }))

    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith(request))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/clients/c1/tour-catalog/publish-requests')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ note: '改了三个团的价格' })
  })

  it('allows an empty note', async () => {
    const { onSubmitted } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '提交' }))

    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith(request))
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ note: '' })
  })

  it('shows an alert and keeps the dialog open on a server failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'publish_failed' }, 500))
    const { onSubmitted } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '提交' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(REQUEST_PUBLISH_ERROR)
    expect(onSubmitted).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('shows an alert on a malformed ok body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    const { onSubmitted } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '提交' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(REQUEST_PUBLISH_ERROR)
    expect(onSubmitted).not.toHaveBeenCalled()
  })

  it('closes on Escape and on 取消', () => {
    const { onClose } = renderDialog()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('caps the note at 500 characters', () => {
    renderDialog()
    expect(screen.getByLabelText('这次改了什么（选填）')).toHaveAttribute('maxlength', '500')
  })
})

describe('publishRequestNoticeText', () => {
  it('tells an editor the team was notified', () => {
    const text = publishRequestNoticeText(request, false, 5)
    expect(text).toMatch(
      /^已通知 Magic Engine 团队 · 2026年10月\d+日 \d{2}:\d{2}。还没上架，对方核对后会上架。$/,
    )
  })

  it('adds the newer-edits suffix when the draft moved on', () => {
    const text = publishRequestNoticeText(request, false, 7)
    expect(text.endsWith('。还没上架；之后又有新的修改，可以再提交一次更新说明。')).toBe(true)
  })

  it('omits the suffix when the draft version is unknown', () => {
    const text = publishRequestNoticeText(request, false, null)
    expect(text).not.toContain('之后又有新的修改')
  })

  it('shows the note to a publisher', () => {
    const text = publishRequestNoticeText(request, true, 5)
    expect(text).toMatch(/^amy@example\.test 在 2026年10月\d+日 \d{2}:\d{2} 请你上架：改了价格$/)
  })

  it('says there was no note when the note is empty', () => {
    const text = publishRequestNoticeText({ ...request, note: '   ' }, true, 5)
    expect(text.endsWith('请你上架（没有留备注）')).toBe(true)
  })
})

describe('PublishRequestNotice', () => {
  it('renders nothing without a request', () => {
    const { container } = render(
      <PublishRequestNotice request={null} canPublish={false} draftVersion={null} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a status line with a request', () => {
    render(<PublishRequestNotice request={request} canPublish={false} draftVersion={5} />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
