/**
 * CampaignDailyAutoPublishPanel — the PM-facing half of the unattended
 * Daily Plan publisher.
 *
 * The server owns every check; this file locks the *interface* promises the
 * panel makes on top of them:
 *   - a failed status read is never dressed up as "not authorised";
 *   - going live always costs a second, explicit click;
 *   - what the PM reads is plain Chinese, and the request bodies carry the
 *     exact identity fields the routes demand.
 *
 * The component reads `res.text()` (not `res.json()`) so it can tell a JSON
 * answer from a proxy's HTML page; the mocks below answer in the same shape.
 */
import React from 'react'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CampaignDailyAutoPublishPanel } from '../CampaignDailyAutoPublishPanel'

const CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const CAMPAIGN_ID = '6612eabf-dd7e-47f0-bcc4-e6a7fd813aea'
const PLAN_ID = 'f166a5c0-b2df-478c-8b04-1168ef2d3641'
const PLAN_REVISION = '2026-09-01T15:00:04.513Z'
const REVIEW_REVISION = '40b720ac-dfe4-44b6-8192-6f3f93ad3bdb'
const PAGE_ID = '1616575215312482'

const STATUS_URL = `/api/clients/${CLIENT_ID}/campaign-daily-plan/auto-publish/status?plan_id=${encodeURIComponent(PLAN_ID)}&plan_revision=${encodeURIComponent(PLAN_REVISION)}&review_revision=${encodeURIComponent(REVIEW_REVISION)}`

function props(overrides: Record<string, unknown> = {}) {
  return {
    clientId: CLIENT_ID,
    campaignId: CAMPAIGN_ID,
    planId: PLAN_ID,
    planRevision: PLAN_REVISION,
    reviewRevision: REVIEW_REVISION,
    facebookPageId: PAGE_ID,
    reviewedDates: ['2026-09-03', '2026-09-04'],
    queueReceiptReady: true,
    // 06:00 on 2026-09-01 in Auckland: today's 08:00 slot is still ahead
    now: new Date('2026-08-31T18:00:00Z'),
    ...overrides,
  }
}

/** The component reads res.text() so it can tell JSON from a proxy's HTML. */
function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }
}

function htmlResponse(status: number, html = '<!DOCTYPE html><html><body><h1>A timeout occurred</h1></body></html>') {
  return { ok: false, status, text: async () => html }
}

/**
 * The panel always GETs status first, then POSTs. `mockFetch` queues the
 * answers in call order and falls back to a benign success afterwards.
 */
function mockFetch(...responses: unknown[]) {
  const fn = vi.fn()
  for (const body of responses) fn.mockResolvedValueOnce(jsonResponse(body))
  fn.mockResolvedValue(jsonResponse({ success: true }))
  global.fetch = fn as never
  return fn
}

function bodyOf(fetchMock: ReturnType<typeof vi.fn>, call: number) {
  return JSON.parse((fetchMock.mock.calls[call][1] as { body: string }).body)
}

function urlOf(fetchMock: ReturnType<typeof vi.fn>, call: number) {
  return fetchMock.mock.calls[call][0] as string
}

const MANAGEABLE_STATUS = {
  success: true,
  can_manage: true,
  mode: 'practice' as const,
  authorization: null,
  attempts: [],
}

const PREVIEW_BODY = {
  success: true,
  would_publish: [
    { date: '2026-09-03', message_preview: 'Hook 1 …' },
    { date: '2026-09-04', message_preview: 'Hook 2 …' },
  ],
  would_lift_recalled: [],
}

/** Render and let the mount-time status GET settle. */
async function renderPanel(overrides: Record<string, unknown> = {}) {
  const view = render(<CampaignDailyAutoPublishPanel {...props(overrides)} />)
  await act(async () => {
    await Promise.resolve()
  })
  return view
}

async function click(name: RegExp | string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('auto-publish panel — who may see it at all', () => {
  it('renders nothing when the caller cannot manage this plan', async () => {
    mockFetch({ success: true, can_manage: false })
    const { container } = await renderPanel()

    await waitFor(() => {
      expect(container.querySelector('[data-testid="auto-publish-panel"]')).toBeNull()
    })
    expect(screen.queryByText(/自动发布/)).toBeNull()
  })

  it('renders nothing when there is no plan to authorise', async () => {
    mockFetch(MANAGEABLE_STATUS)
    const { container } = await renderPanel({ planId: null })

    expect(container.querySelector('[data-testid="auto-publish-panel"]')).toBeNull()
  })
})

describe('auto-publish panel — a failed read is never "not authorised"', () => {
  it('shows the red read-failure line when the status request fails', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ success: false, error: 'INTERNAL_ERROR' }, 500)) as never
    await renderPanel()

    await waitFor(() => {
      expect(screen.getByText(/读不到自动发布的状态/)).toBeTruthy()
    })
    // The failure must not be dressed up as "nothing is running".
    expect(screen.queryByText(/预览自动发布/)).toBeNull()
    expect(screen.queryByText(/已授权自动发布/)).toBeNull()
  })

  it('shows a readable error when a proxy answers with HTML instead of JSON', async () => {
    global.fetch = vi.fn().mockResolvedValue(htmlResponse(524)) as never
    await renderPanel()

    await waitFor(() => {
      expect(screen.getByText(/服务暂时没响应/)).toBeTruthy()
    })
    // no status codes or page fragments shown to the PM
    expect(screen.queryByText(/Unexpected token/)).toBeNull()
  })
})

describe('auto-publish panel — practice vs live', () => {
  it('says plainly that practice mode will not post to Facebook', async () => {
    mockFetch({ ...MANAGEABLE_STATUS, mode: 'practice' })
    await renderPanel()

    await waitFor(() => {
      expect(screen.getByText(/演练模式/)).toBeTruthy()
    })
    expect(screen.getByText(/不会往 Facebook 发任何东西/)).toBeTruthy()
  })

  it('says plainly that live mode will post every morning', async () => {
    mockFetch({ ...MANAGEABLE_STATUS, mode: 'live' })
    await renderPanel()

    await waitFor(() => {
      expect(screen.getByText(/真发模式/)).toBeTruthy()
    })
    expect(screen.getByText(/新西兰时间每天早上 8 点公开/)).toBeTruthy()
  })
})

describe('auto-publish panel — what it reads', () => {
  it('reads the status of exactly this plan and revisions, uncached', async () => {
    const fetchMock = mockFetch(MANAGEABLE_STATUS)
    await renderPanel()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toBe(STATUS_URL)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-store' })
  })

  it('🔴 a grant that can no longer be authorised against (plan changed) still offers the stop button, even with the queue receipt gone', async () => {
    mockFetch({
      ...MANAGEABLE_STATUS,
      authorization: {
        id: 'auth-1', dates: ['2026-09-03'], lifted_dates: [], authorized_by_email: 'pm@example.test',
        authorized_at: '2026-09-01T00:00:00.000Z', activated_at: '2026-09-01T00:00:05.000Z',
        expires_at: '2026-09-15T00:00:00.000Z', state: 'plan_changed',
      },
    })
    await renderPanel({ queueReceiptReady: false })
    await waitFor(() => expect(screen.getByRole('button', { name: /停止自动发布/ })).toBeTruthy())
  })
})

describe('auto-publish panel — visitors who may not manage it', () => {
  it('🔴 a 403 (or 401) from the status read shows nothing at all — no red error line for someone this section is not for', async () => {
    for (const status of [401, 403]) {
      const fn = vi.fn().mockResolvedValue(jsonResponse({ success: false, error: 'forbidden' }, status))
      global.fetch = fn as never
      const { container } = await renderPanel()
      await waitFor(() => expect(fn).toHaveBeenCalled())
      expect(container.textContent).toBe('')
      cleanup()
    }
  })
})

describe('auto-publish panel — the authorise button is gated', () => {
  it('offers no authorise button until the queue receipt is ready', async () => {
    mockFetch(MANAGEABLE_STATUS)
    await renderPanel({ queueReceiptReady: false })

    await waitFor(() => {
      expect(screen.getByTestId('auto-publish-panel')).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: /预览自动发布/ })).toBeNull()
    expect(screen.getByText(/现在还不能授权/)).toBeTruthy()
  })

  it('offers no authorise button when no dates were reviewed', async () => {
    mockFetch(MANAGEABLE_STATUS)
    await renderPanel({ reviewedDates: [] })

    await waitFor(() => {
      expect(screen.getByTestId('auto-publish-panel')).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: /预览自动发布/ })).toBeNull()
  })

  it('offers no authorise button when the client has no registered Page', async () => {
    mockFetch(MANAGEABLE_STATUS)
    await renderPanel({ facebookPageId: null })

    await waitFor(() => {
      expect(screen.getByText(/还没登记 Facebook 主页/)).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: /预览自动发布/ })).toBeNull()
  })
})

describe('auto-publish panel — preview then confirm', () => {
  it('previews with confirm:false and sends the reviewed dates', async () => {
    const fetchMock = mockFetch(MANAGEABLE_STATUS, PREVIEW_BODY)
    await renderPanel()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /预览自动发布/ })).toBeTruthy()
    })
    await click(/预览自动发布/)

    expect(urlOf(fetchMock, 1)).toBe(`/api/clients/${CLIENT_ID}/campaign-daily-plan/auto-publish/authorize`)
    expect(bodyOf(fetchMock, 1)).toMatchObject({
      client_id: CLIENT_ID,
      campaign_id: CAMPAIGN_ID,
      plan_id: PLAN_ID,
      plan_revision: PLAN_REVISION,
      review_revision: REVIEW_REVISION,
      page_id: PAGE_ID,
      dates: ['2026-09-03', '2026-09-04'],
      confirm: false,
    })
  })

  it('shows the would-publish rows and the confirm button after a preview', async () => {
    mockFetch(MANAGEABLE_STATUS, PREVIEW_BODY)
    await renderPanel()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /预览自动发布/ })).toBeTruthy()
    })
    await click(/预览自动发布/)

    expect(screen.getByText(/演练：授权后只会模拟，不会真发这 2 条/)).toBeTruthy()
    expect(screen.getByText(/Hook 1/)).toBeTruthy()
    expect(screen.getByText(/Hook 2/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /演练授权（不会真发）/ })).toBeTruthy()
  })

  it('does not authorise when the confirm button is merely revealed', async () => {
    const fetchMock = mockFetch(MANAGEABLE_STATUS, PREVIEW_BODY)
    await renderPanel()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /预览自动发布/ })).toBeTruthy()
    })
    await click(/预览自动发布/)
    await click(/演练授权（不会真发）/)

    expect(screen.getByText(/授权只是试跑，不会真的发到 Facebook。确定试跑？/)).toBeTruthy()
    // Only the status GET and the preview POST so far.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('sends confirm:true only after the extra 「确定，授权」 click', async () => {
    const fetchMock = mockFetch(MANAGEABLE_STATUS, PREVIEW_BODY, { success: true })
    await renderPanel()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /预览自动发布/ })).toBeTruthy()
    })
    await click(/预览自动发布/)
    await click(/演练授权（不会真发）/)
    await click(/确定，演练授权/)

    expect(bodyOf(fetchMock, 2)).toMatchObject({ confirm: true })
  })

  it('refetches the status after a successful authorisation', async () => {
    const fetchMock = mockFetch(MANAGEABLE_STATUS, PREVIEW_BODY, { success: true })
    await renderPanel()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /预览自动发布/ })).toBeTruthy()
    })
    await click(/预览自动发布/)
    await click(/演练授权（不会真发）/)
    await click(/确定，演练授权/)

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(c => (c[0] as string).includes('/status?')).length).toBe(2)
    })
  })
})

describe('auto-publish panel — recalled dates need a second yes', () => {
  it('asks again and sends lift_recalled_dates on the repeat', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(MANAGEABLE_STATUS))
      .mockResolvedValueOnce(jsonResponse({ success: false, error: 'DATE_RECALLED', dates: ['2026-09-03'] }, 409))
      .mockResolvedValueOnce(jsonResponse(PREVIEW_BODY))
    global.fetch = fetchMock as never
    await renderPanel()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /预览自动发布/ })).toBeTruthy()
    })
    await click(/预览自动发布/)

    expect(screen.getByText(/这些日期之前撤回过/)).toBeTruthy()
    await click(/把这些日期加入预览/)

    expect(bodyOf(fetchMock, 2)).toMatchObject({ lift_recalled_dates: ['2026-09-03'] })
  })
})

describe('auto-publish panel — server refusals are translated', () => {
  it('maps ALREADY_AUTHORIZED to plain Chinese', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(MANAGEABLE_STATUS))
      .mockResolvedValueOnce(jsonResponse({ success: false, error: 'ALREADY_AUTHORIZED' }, 409))
    global.fetch = fetchMock as never
    await renderPanel()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /预览自动发布/ })).toBeTruthy()
    })
    await click(/预览自动发布/)

    expect(screen.getByText(/这份计划已经授权了，先停止再重新授权/)).toBeTruthy()
  })
})

describe('auto-publish panel — an active authorisation is legible', () => {
  const ACTIVE_STATUS = {
    success: true,
    can_manage: true,
    mode: 'live' as const,
    authorization: {
      id: 'auth-1',
      dates: ['2026-09-03', '2026-09-04'],
      lifted_dates: [],
      authorized_by_email: 'pm@ctstours.co.nz',
      authorized_at: '2026-09-01T15:00:04.513Z',
      activated_at: '2026-09-01T15:00:05.000Z',
      expires_at: '2026-09-15T15:00:04.513Z',
      state: 'active' as const,
    },
    attempts: [],
  }

  it('shows who authorised it, when it expires and which dates it covers', async () => {
    mockFetch(ACTIVE_STATUS)
    await renderPanel()

    await waitFor(() => {
      expect(screen.getByText(/真发授权中/)).toBeTruthy()
    })
    expect(screen.getByText(/pm@ctstours.co.nz/)).toBeTruthy()
    expect(screen.getByText(/到期/)).toBeTruthy()
    expect(screen.getByText(/覆盖日期：09-03、09-04/)).toBeTruthy()
  })

  it('keeps the stop button disabled until a reason is typed', async () => {
    mockFetch(ACTIVE_STATUS)
    await renderPanel()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /停止自动发布/ })).toBeTruthy()
    })
    const stop = screen.getByRole('button', { name: /停止自动发布/ })
    expect(stop).toBeDisabled()

    fireEvent.change(screen.getByLabelText('停止原因'), { target: { value: '计划要改' } })
    expect(stop).toBeEnabled()
  })

  it('sends the trimmed reason in the revoke body', async () => {
    const fetchMock = mockFetch(ACTIVE_STATUS, { success: true })
    await renderPanel()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /停止自动发布/ })).toBeTruthy()
    })
    fireEvent.change(screen.getByLabelText('停止原因'), { target: { value: '  计划要改  ' } })
    await click(/停止自动发布/)
    await click(/确定，停止/)

    expect(urlOf(fetchMock, 1)).toBe(`/api/clients/${CLIENT_ID}/campaign-daily-plan/auto-publish/revoke`)
    expect(bodyOf(fetchMock, 1)).toMatchObject({ reason: '计划要改' })
  })

  it('lists the posts already handed to Facebook that stopping will not pull down', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(ACTIVE_STATUS))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        in_flight_status: 'OK',
        in_flight: [{ date: '2026-09-03' }],
      }))
      // after the revoke the status is read again: the grant is gone, but the notice must stay
      .mockResolvedValueOnce(jsonResponse(MANAGEABLE_STATUS))
    global.fetch = fetchMock as never
    await renderPanel()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /停止自动发布/ })).toBeTruthy()
    })
    fireEvent.change(screen.getByLabelText('停止原因'), { target: { value: '计划要改' } })
    await click(/停止自动发布/)
    await click(/确定，停止/)

    // the notice survives the refetch even though the grant is gone and the stop button with it
    await waitFor(() => expect(screen.getByText(/停止不会撤下它们/)).toBeTruthy())
    expect(screen.getByText(/09-03/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /停止自动发布/ })).toBeNull()
  })

  it('🔴 shows dates whose outcome nobody has confirmed after stopping', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(ACTIVE_STATUS))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        in_flight_status: 'OK',
        in_flight: [],
        in_flight_unconfirmed: [{ date: '2026-09-04', status: 'unknown_outcome' }],
      }))
      .mockResolvedValueOnce(jsonResponse(MANAGEABLE_STATUS))
    global.fetch = fetchMock as never
    await renderPanel()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /停止自动发布/ })).toBeTruthy()
    })
    fireEvent.change(screen.getByLabelText('停止原因'), { target: { value: '计划要改' } })
    await click(/停止自动发布/)
    await click(/确定，停止/)

    await waitFor(() => expect(screen.getByText(/系统不确定有没有发出去：.*09-04/)).toBeTruthy())
  })

  it('says so in red when it cannot tell what is already in flight', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(ACTIVE_STATUS))
      .mockResolvedValueOnce(jsonResponse({ success: true, in_flight_status: 'UNKNOWN', in_flight: [] }))
      .mockResolvedValueOnce(jsonResponse(MANAGEABLE_STATUS))
    global.fetch = fetchMock as never
    await renderPanel()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /停止自动发布/ })).toBeTruthy()
    })
    fireEvent.change(screen.getByLabelText('停止原因'), { target: { value: '计划要改' } })
    await click(/停止自动发布/)
    await click(/确定，停止/)

    await waitFor(() => expect(screen.getByText(/没能确认 Facebook 上有没有已排好时间/)).toBeTruthy())
  })
})

describe('auto-publish panel — attempt rows read as plain Chinese', () => {
  function statusWithAttempts(attempts: unknown[]) {
    return { ...MANAGEABLE_STATUS, attempts }
  }

  it('translates a recalled block instead of showing the raw code', async () => {
    mockFetch(statusWithAttempts([
      { date: '2026-09-03', status: 'blocked', reason_code: 'RECALLED', attempt_no: 1, next_retry_at: null, post_id: null },
    ]))
    await renderPanel()

    await waitFor(() => {
      expect(screen.getByText(/已撤回，不会再自动发/)).toBeTruthy()
    })
    expect(screen.queryByText(/RECALLED/)).toBeNull()
  })

  it('names the reason for a non-recalled block', async () => {
    mockFetch(statusWithAttempts([
      { date: '2026-09-03', status: 'blocked', reason_code: 'PRICE_CLAIM_UNBACKED', attempt_no: 1, next_retry_at: null, post_id: null },
    ]))
    await renderPanel()

    await waitFor(() => {
      expect(screen.getByText(/价格检查没通过，这条不会发/)).toBeTruthy()
      expect(screen.queryByText(/PRICE_CLAIM_UNBACKED/)).toBeNull()
    })
  })

  it('shows the retry count for a retryable failure', async () => {
    mockFetch(statusWithAttempts([
      { date: '2026-09-03', status: 'failed_retryable', reason_code: null, attempt_no: 2, next_retry_at: null, post_id: null },
    ]))
    await renderPanel()

    await waitFor(() => {
      expect(screen.getByText(/下次检查时会自动再试（已试 2 次）/)).toBeTruthy()
    })
  })
})

describe('auto-publish panel — unknown outcomes are confirmed by hand', () => {
  const UNKNOWN_STATUS = {
    ...MANAGEABLE_STATUS,
    attempts: [
      { date: '2026-09-03', status: 'unknown_outcome', reason_code: null, attempt_no: 1, next_retry_at: null, post_id: null },
    ],
  }

  it('does not call confirm-unknown until one of the two outcome buttons is clicked', async () => {
    const fetchMock = mockFetch(UNKNOWN_STATUS)
    await renderPanel()

    await waitFor(() => {
      expect(screen.getByText(/不确定有没有发出去/)).toBeTruthy()
    })
    await click(/核对并登记这一条/)

    expect(screen.getByText(/把「已定时」和「已发布」两处都看一遍/)).toBeTruthy()
    // each outcome states its consequence before it is chosen
    expect(screen.getByText(/会重复发两次/)).toBeTruthy()
    expect(screen.getByText(/不会再发这一天/)).toBeTruthy()
    // Only the status GET so far.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('sends outcome=published when the PM confirms the post is on the Page', async () => {
    const fetchMock = mockFetch(UNKNOWN_STATUS, { success: true })
    await renderPanel()

    await waitFor(() => {
      expect(screen.getByText(/不确定有没有发出去/)).toBeTruthy()
    })
    await click(/核对并登记这一条/)
    await click(/主页上有这条，记为已发出/)

    expect(urlOf(fetchMock, 1)).toBe(`/api/clients/${CLIENT_ID}/campaign-daily-plan/auto-publish/confirm-unknown`)
    expect(bodyOf(fetchMock, 1)).toMatchObject({ date: '2026-09-03', outcome: 'published' })
  })

  it('sends outcome=not_published when the PM confirms the post is absent', async () => {
    const fetchMock = mockFetch(UNKNOWN_STATUS, { success: true })
    await renderPanel()

    await waitFor(() => {
      expect(screen.getByText(/不确定有没有发出去/)).toBeTruthy()
    })
    await click(/核对并登记这一条/)
    await click(/主页上确实没有，允许重发/)

    expect(bodyOf(fetchMock, 1)).toMatchObject({ date: '2026-09-03', outcome: 'not_published' })
  })

  it('a failed registration says so, re-reads the state, and does not leave the screen out of date', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(UNKNOWN_STATUS))
      .mockResolvedValueOnce(jsonResponse({ success: false, error: 'NO_UNKNOWN_OUTCOME' }, 404))
      .mockResolvedValue(jsonResponse(MANAGEABLE_STATUS))
    global.fetch = fetchMock as never
    await renderPanel()
    await waitFor(() => expect(screen.getByText(/不确定有没有发出去/)).toBeTruthy())
    await click(/核对并登记这一条/)
    await click(/主页上有这条，记为已发出/)

    await waitFor(() => expect(screen.getByText(/登记没有成功/)).toBeTruthy())
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3)) // status read again
  })
})

describe('auto-publish panel — what a failure must not hide', () => {
  const ACTIVE = {
    ...MANAGEABLE_STATUS,
    authorization: {
      id: 'auth-1', dates: ['2026-09-03'], lifted_dates: [], authorized_by_email: 'pm@example.test',
      authorized_at: '2026-09-01T00:00:00.000Z', activated_at: '2026-09-01T00:00:05.000Z',
      expires_at: '2026-09-15T00:00:00.000Z', state: 'active' as const,
    },
  }

  it('🔴 when the status cannot be read, the STOP control is still there and works', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: false, error: 'INTERNAL_ERROR' }, 500))
      .mockResolvedValue(jsonResponse({ success: true, in_flight_status: 'UNKNOWN', in_flight: [] }))
    global.fetch = fetchMock as never
    await renderPanel()

    await waitFor(() => expect(screen.getByText(/读不到自动发布的状态/)).toBeTruthy())
    fireEvent.change(screen.getByLabelText('停止原因'), { target: { value: '先停下来' } })
    await click(/停止自动发布/)
    await click(/确定，停止/)

    expect(urlOf(fetchMock, 1)).toBe(`/api/clients/${CLIENT_ID}/campaign-daily-plan/auto-publish/revoke`)
    expect(bodyOf(fetchMock, 1)).toMatchObject({ reason: '先停下来' })
  })

  it('🔴 a failed authorise whose rollback also failed says the grant may still be active, and re-reads the state', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(MANAGEABLE_STATUS))
      .mockResolvedValueOnce(jsonResponse(PREVIEW_BODY))
      .mockResolvedValueOnce(jsonResponse({ success: false, error: 'AUTHORIZATION_EVENT_NOT_SENT', rollback: 'FAILED' }, 500))
      .mockResolvedValue(jsonResponse(ACTIVE))
    global.fetch = fetchMock as never
    await renderPanel()
    await waitFor(() => expect(screen.getByRole('button', { name: /预览自动发布/ })).toBeTruthy())
    await click(/预览自动发布/)
    await click(/演练授权（不会真发）/)
    await click(/确定，演练授权/)

    await waitFor(() => expect(screen.getByText(/授权可能仍然有效/)).toBeTruthy())
    // the state was read again, so the grant (and the stop control) appears
    await waitFor(() => expect(screen.getByRole('button', { name: /停止自动发布/ })).toBeTruthy())
  })

  it('a failed stop says the grant may still be active and re-reads the state', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(ACTIVE))
      .mockResolvedValueOnce(jsonResponse({ success: false, error: 'INTERNAL_ERROR' }, 500))
      .mockResolvedValue(jsonResponse(ACTIVE))
    global.fetch = fetchMock as never
    await renderPanel()
    await waitFor(() => expect(screen.getByRole('button', { name: /停止自动发布/ })).toBeTruthy())
    fireEvent.change(screen.getByLabelText('停止原因'), { target: { value: '计划要改' } })
    await click(/停止自动发布/)
    await click(/确定，停止/)

    await waitFor(() => expect(screen.getByText(/自动发布可能仍然有效/)).toBeTruthy())
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3))
  })
})

describe('auto-publish panel — dates and previews', () => {
  it('🔴 never sends dates that have already passed, and says which were left out', async () => {
    const fetchMock = mockFetch(MANAGEABLE_STATUS, PREVIEW_BODY)
    await renderPanel({ reviewedDates: ['2026-08-30', '2026-09-03', '2026-09-04'] })
    await waitFor(() => expect(screen.getByRole('button', { name: /预览自动发布/ })).toBeTruthy())
    expect(screen.getByText(/已经过去的日期、以及今天已过早上 8 点的那一条，不会自动发：08-30/)).toBeTruthy()
    await click(/预览自动发布/)

    expect(bodyOf(fetchMock, 1).dates).toEqual(['2026-09-03', '2026-09-04'])
  })

  it('offers nothing to authorise when every reviewed date has passed', async () => {
    mockFetch(MANAGEABLE_STATUS)
    await renderPanel({ reviewedDates: ['2026-08-30'] })
    await waitFor(() => expect(screen.getByText(/今天没有可发的已审核帖子/)).toBeTruthy())
    expect(screen.queryByRole('button', { name: /预览自动发布/ })).toBeNull()
  })

  it('shows the first comment and the publish time of each previewed post', async () => {
    mockFetch(MANAGEABLE_STATUS, {
      ...PREVIEW_BODY,
      would_publish: [{ date: '2026-09-03', message_preview: 'Hook 1 …', first_comment_preview: 'Book here: https://x.test' }],
    })
    await renderPanel()
    await waitFor(() => expect(screen.getByRole('button', { name: /预览自动发布/ })).toBeTruthy())
    await click(/预览自动发布/)

    expect(screen.getByText(/第一条评论：Book here/)).toBeTruthy()
    expect(screen.getByText(/09-03（演练：不会真发）/)).toBeTruthy()
  })

  it('🔴 a changed plan version clears an old preview so it cannot be confirmed against the new plan', async () => {
    mockFetch(MANAGEABLE_STATUS, PREVIEW_BODY)
    const view = await renderPanel()
    await waitFor(() => expect(screen.getByRole('button', { name: /预览自动发布/ })).toBeTruthy())
    await click(/预览自动发布/)
    expect(screen.getByRole('button', { name: /演练授权（不会真发）/ })).toBeTruthy()

    view.rerender(<CampaignDailyAutoPublishPanel {...props({ reviewRevision: '99999999-dfe4-44b6-8192-6f3f93ad3bdb' })} />)
    await act(async () => { await Promise.resolve() })

    expect(screen.queryByRole('button', { name: /演练授权（不会真发）/ })).toBeNull()
  })

  it('🔴 a mode that is missing is never shown as live', async () => {
    mockFetch({ success: true, can_manage: true, authorization: null, attempts: [] })
    await renderPanel()
    await waitFor(() => expect(screen.getByText(/读不到当前是演练还是真发/)).toBeTruthy())
    expect(screen.queryByText(/真发模式/)).toBeNull()
  })

  it('live mode wording: the authorise button and the confirmation say it really publishes', async () => {
    const fetchMock = mockFetch({ ...MANAGEABLE_STATUS, mode: 'live' }, PREVIEW_BODY)
    await renderPanel()
    await waitFor(() => expect(screen.getByRole('button', { name: /预览自动发布/ })).toBeTruthy())
    await click(/预览自动发布/)
    await click(/授权真发 2 条/)

    expect(screen.getByText(/公开后系统不会替你撤回，只能手动撤回/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /确定，真发/ })).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(2) // still only status + preview: nothing authorised yet
  })

  it('a status reply that is not shaped like a status is a read failure, not a vanishing section', async () => {
    mockFetch({ success: true })
    await renderPanel()
    await waitFor(() => expect(screen.getByText(/读不到自动发布的状态/)).toBeTruthy())
  })
})

describe('auto-publish panel — today\'s slot and an unknown mode', () => {
  it('🔴 once today\'s 08:00 slot is (nearly) gone, today\'s date is not offered and is listed as left out', async () => {
    // 07:50 on 2026-09-01 in Auckland
    const fetchMock = mockFetch(MANAGEABLE_STATUS, PREVIEW_BODY)
    await renderPanel({ now: new Date('2026-08-31T19:50:00Z'), reviewedDates: ['2026-09-01', '2026-09-03'] })
    await waitFor(() => expect(screen.getByRole('button', { name: /预览自动发布/ })).toBeTruthy())
    expect(screen.getByText(/今天已过早上 8 点的那一条，不会自动发：09-01/)).toBeTruthy()
    await click(/预览自动发布/)
    expect(bodyOf(fetchMock, 1).dates).toEqual(['2026-09-03'])
  })

  it('today is still offered while its slot is more than 15 minutes away', async () => {
    const fetchMock = mockFetch(MANAGEABLE_STATUS, PREVIEW_BODY)
    await renderPanel({ now: new Date('2026-08-31T19:30:00Z'), reviewedDates: ['2026-09-01', '2026-09-03'] }) // 07:30 NZ
    await waitFor(() => expect(screen.getByRole('button', { name: /预览自动发布/ })).toBeTruthy())
    await click(/预览自动发布/)
    expect(bodyOf(fetchMock, 1).dates).toEqual(['2026-09-01', '2026-09-03'])
  })

  it('🔴 when the mode cannot be read there is no preview or authorise button at all, only the warning', async () => {
    mockFetch({ success: true, can_manage: true, authorization: null, attempts: [] })
    await renderPanel()
    await waitFor(() => expect(screen.getByText(/读不到当前是演练还是真发/)).toBeTruthy())
    expect(screen.queryByRole('button', { name: /预览自动发布/ })).toBeNull()
  })

  it('live mode says plainly that this is a real publish, in the preview too', async () => {
    mockFetch({ ...MANAGEABLE_STATUS, mode: 'live' }, PREVIEW_BODY)
    await renderPanel()
    await waitFor(() => expect(screen.getByRole('button', { name: /预览自动发布/ })).toBeTruthy())
    await click(/预览自动发布/)
    expect(screen.getByText(/授权后会自动发这 2 条/)).toBeTruthy()
    expect(screen.getByText(/09-03 早上 8:00（新西兰时间）公开/)).toBeTruthy()
  })

  it('stopping when there is no grant any more says there is nothing to stop', async () => {
    const ACTIVE = {
      ...MANAGEABLE_STATUS,
      authorization: {
        id: 'auth-1', dates: ['2026-09-03'], lifted_dates: [], authorized_by_email: 'pm@example.test',
        authorized_at: '2026-09-01T00:00:00.000Z', activated_at: '2026-09-01T00:00:05.000Z',
        expires_at: '2026-09-15T00:00:00.000Z', state: 'active' as const,
      },
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(ACTIVE))
      .mockResolvedValueOnce(jsonResponse({ success: false, error: 'NO_ACTIVE_AUTHORIZATION' }, 404))
      .mockResolvedValue(jsonResponse(MANAGEABLE_STATUS))
    global.fetch = fetchMock as never
    await renderPanel()
    await waitFor(() => expect(screen.getByRole('button', { name: /停止自动发布/ })).toBeTruthy())
    fireEvent.change(screen.getByLabelText('停止原因'), { target: { value: '计划要改' } })
    await click(/停止自动发布/)
    await click(/确定，停止/)
    await waitFor(() => expect(screen.getByText(/当前已经没有生效中的授权，不用停止/)).toBeTruthy())
  })
})

describe('auto-publish panel — what a stop must leave visible', () => {
  const ACTIVE = {
    success: true, can_manage: true, mode: 'practice' as const, attempts: [],
    authorization: {
      id: 'auth-1', dates: ['2026-09-03'], lifted_dates: [], authorized_by_email: 'pm@example.test',
      authorized_at: '2026-09-01T00:00:00.000Z', activated_at: '2026-09-01T00:00:05.000Z',
      expires_at: '2026-09-15T00:00:00.000Z', state: 'active' as const,
    },
  }

  it('🔴 after a successful stop the notice about already-scheduled posts is on screen when the status is read again (and the panel is not remounted by the page)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(ACTIVE))
      .mockResolvedValueOnce(jsonResponse({ success: true, in_flight_status: 'OK', in_flight: [{ date: '2026-09-03' }] }))
      .mockResolvedValue(jsonResponse({ ...ACTIVE, authorization: null }))
    global.fetch = fetchMock as never
    await renderPanel()
    await waitFor(() => expect(screen.getByRole('button', { name: /停止自动发布/ })).toBeTruthy())
    fireEvent.change(screen.getByLabelText('停止原因'), { target: { value: '计划要改' } })
    await click(/停止自动发布/)
    await click(/确定，停止/)

    await waitFor(() => expect(screen.getByText(/停止不会撤下它们/)).toBeTruthy())
    expect(screen.getByText(/已停止自动发布，之后不会再自动发帖/)).toBeTruthy()
  })

  it('🔴 in the unreadable state a successful stop still shows what it did and did not take down', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: false, error: 'INTERNAL_ERROR' }, 500))
      .mockResolvedValueOnce(jsonResponse({ success: true, in_flight_status: 'OK', in_flight: [] }))
      .mockResolvedValue(jsonResponse({ success: false, error: 'INTERNAL_ERROR' }, 500))
    global.fetch = fetchMock as never
    await renderPanel()
    await waitFor(() => expect(screen.getByLabelText('停止原因')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('停止原因'), { target: { value: '先停下来' } })
    await click(/停止自动发布/)
    await click(/确定，停止/)

    await waitFor(() => expect(screen.getByText(/已停止自动发布，之后不会再自动发帖/)).toBeTruthy())
  })

  it('the stop control does not vanish while a failed read is being retried', async () => {
    let release: (value: unknown) => void = () => undefined
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: false, error: 'INTERNAL_ERROR' }, 500))
      .mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    global.fetch = fetchMock as never
    const view = await renderPanel()
    await waitFor(() => expect(screen.getByLabelText('停止原因')).toBeTruthy())
    view.rerender(<CampaignDailyAutoPublishPanel {...props({ reviewRevision: '99999999-dfe4-44b6-8192-6f3f93ad3bdb' })} />)
    await act(async () => { await Promise.resolve() })

    expect(screen.getByLabelText('停止原因')).toBeTruthy()
    release(jsonResponse(MANAGEABLE_STATUS))
  })

  it('the page trusts the server clock over the computer clock when deciding which dates are gone', async () => {
    // the computer thinks it is 2026-08-20; the server says it is 2026-09-04 06:00 NZ, so 09-03 is gone and 09-04 is still open
    const fetchMock = mockFetch({ ...MANAGEABLE_STATUS, server_now: '2026-09-03T18:00:00Z' }, PREVIEW_BODY)
    await renderPanel({ now: undefined, reviewedDates: ['2026-09-03', '2026-09-04'] })
    await waitFor(() => expect(screen.getByRole('button', { name: /预览自动发布/ })).toBeTruthy())
    await click(/预览自动发布/)
    expect(bodyOf(fetchMock, 1).dates).toEqual(['2026-09-04'])
  })

  it('a 401/403 that arrives as a web page is still treated as "not for this visitor"', async () => {
    global.fetch = vi.fn().mockResolvedValue(htmlResponse(403)) as never
    const { container } = await renderPanel()
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('a network failure is shown in plain Chinese, not as a browser error string', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) as never
    await renderPanel()
    await waitFor(() => expect(screen.getByText(/网络没连上/)).toBeTruthy())
    expect(screen.queryByText(/Failed to fetch/)).toBeNull()
  })
})

describe('auto-publish panel — an authorisation while the mode is unknown', () => {
  it('🔴 never tells the PM it "will not really publish" when it cannot read whether that is true', async () => {
    mockFetch({
      success: true, can_manage: true, attempts: [],
      authorization: {
        id: 'auth-1', dates: ['2026-09-03'], lifted_dates: [], authorized_by_email: 'pm@example.test',
        authorized_at: '2026-09-01T00:00:00.000Z', activated_at: '2026-09-01T00:00:05.000Z',
        expires_at: '2026-09-15T00:00:00.000Z', state: 'active',
      },
    })
    await renderPanel()
    await waitFor(() => expect(screen.getByText(/已授权，但读不到当前是演练还是真发/)).toBeTruthy())
    expect(screen.queryByText(/已授权（演练中，不会真发）/)).toBeNull()
    // stopping is still possible
    expect(screen.getByRole('button', { name: /停止自动发布/ })).toBeTruthy()
  })
})

